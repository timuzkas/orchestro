package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/timuzkas/orchestro/api/models"
	"github.com/timuzkas/orchestro/api/orchestrator"
	"gorm.io/gorm"
)

var (
	deploymentCancels = make(map[uint]context.CancelFunc)
	cancelMutex       sync.Mutex
)

func main() {
	db, err := gorm.Open(sqlite.Open("data/orchestro.db"), &gorm.Config{})
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}

	err = db.AutoMigrate(&models.Project{}, &models.EnvVar{}, &models.Deployment{}, &models.Backup{}, &models.Volume{})
	if err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	orch, err := orchestrator.NewDockerOrchestrator()
	if err != nil {
		log.Fatalf("failed to initialize orchestrator: %v", err)
	}

	hub := newHub()
	go hub.run()

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "healthy",
		})
	})

	// --- PUBLIC ENDPOINTS ---
	public := r.Group("/api/v1")
	{
		public.GET("/webhooks/:id/:provider", func(c *gin.Context) {
			c.String(200, "Orchestro Webhook Endpoint is active. Please use POST requests for triggers.")
		})

		public.POST("/webhooks/:id/:provider", func(c *gin.Context) {
			id := c.Param("id")
			provider := c.Param("provider")
			fmt.Printf("Webhook received: ID=%s, Provider=%s\n", id, provider)

			var project models.Project
			if err := db.Preload("EnvVars").Preload("Volumes").First(&project, id).Error; err != nil {
				fmt.Printf("Webhook error: Project %s not found\n", id)
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}

			trigger := false
			if provider == "github" || provider == "gitlab" {
				var payload struct {
					Ref string `json:"ref"`
				}
				if err := c.ShouldBindJSON(&payload); err == nil {
					branch := strings.TrimPrefix(payload.Ref, "refs/heads/")
					fmt.Printf("Webhook payload: branch=%s, target_branch=%s\n", branch, project.WebhookBranch)
					if branch == project.WebhookBranch || project.WebhookBranch == "" {
						trigger = true
					}
				} else {
					fmt.Printf("Webhook error: failed to bind JSON: %v\n", err)
				}
			}

			if trigger {
				fmt.Printf("Webhook success: triggering deployment for project %d\n", project.ID)
				c.JSON(202, gin.H{"message": "Deployment triggered"})
				go handleDeploy(context.Background(), db, orch, hub, project)
			} else {
				fmt.Printf("Webhook skipped: no action for project %d\n", project.ID)
				c.JSON(200, gin.H{"message": "No action taken"})
			}
		})
	}

	// --- AUTHORIZED ENDPOINTS ---
	authorized := r.Group("/")
	apiUser := os.Getenv("API_USER")
	apiPass := os.Getenv("API_PASS")
	if apiUser != "" && apiPass != "" {
		authorized.Use(gin.BasicAuth(gin.Accounts{
			apiUser: apiPass,
		}))
	}

	authorized.GET("/ws", func(c *gin.Context) {
		serveWs(hub, c.Writer, c.Request)
	})

	v1 := authorized.Group("/api/v1")
	{
		v1.GET("/projects", func(c *gin.Context) {
			var projects []models.Project
			db.Preload("Deployments", func(db *gorm.DB) *gorm.DB {
				return db.Order("id DESC")
			}).Find(&projects)

			type projectWithLive struct {
				models.Project
				LiveState string `json:"live_state"`
			}

			var results []projectWithLive
			for _, p := range projects {
				state := "stopped"
				if len(p.Deployments) > 0 && p.Deployments[0].ContainerID != "" {
					s, _ := orch.GetContainerStatus(context.Background(), p.Deployments[0].ContainerID)
					state = s
				}
				results = append(results, projectWithLive{
					Project:   p,
					LiveState: state,
				})
			}
			c.JSON(200, results)
		})

		v1.GET("/projects/:id", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.Preload("Deployments", func(db *gorm.DB) *gorm.DB {
				return db.Order("id DESC")
			}).Preload("EnvVars").Preload("Backups").Preload("Volumes").First(&project, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}

			liveInfo := gin.H{"state": "stopped", "memory": 0}
			if len(project.Deployments) > 0 && project.Deployments[0].ContainerID != "" {
				containerID := project.Deployments[0].ContainerID
				status, _ := orch.GetContainerStatus(context.Background(), containerID)
				mem, _, _ := orch.GetContainerStats(context.Background(), containerID)
				liveInfo["state"] = status
				liveInfo["memory"] = mem
			}

			c.JSON(200, gin.H{
				"project": project,
				"live":    liveInfo,
			})
		})

		v1.GET("/projects/:id/files", func(c *gin.Context) {
			c.JSON(200, []string{})
		})

		v1.GET("/projects/:id/logs/runtime", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.Preload("Deployments", func(db *gorm.DB) *gorm.DB {
				return db.Order("id DESC")
			}).First(&project, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}

			if len(project.Deployments) == 0 || project.Deployments[0].ContainerID == "" {
				c.JSON(400, gin.H{"error": "No running container found"})
				return
			}

			reader, err := orch.GetContainerLogs(context.Background(), project.Deployments[0].ContainerID)
			if err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			defer reader.Close()

			buf := make([]byte, 8192)
			n, _ := reader.Read(buf)

			output := ""
			data := buf[:n]
			for len(data) > 8 {
				size := int(data[4])<<24 | int(data[5])<<16 | int(data[6])<<8 | int(data[7])
				end := 8 + size
				if end > len(data) {
					output += string(data[8:])
					break
				}
				output += string(data[8:end])
				data = data[end:]
			}
			if output == "" && n > 0 {
				output = string(buf[:n])
			}

			c.String(200, output)
		})

		v1.GET("/stats", func(c *gin.Context) {
			var projectCount int64
			var deploymentCount int64
			db.Model(&models.Project{}).Count(&projectCount)
			db.Model(&models.Deployment{}).Count(&deploymentCount)

			var activeContainers int64
			db.Model(&models.Deployment{}).Where("status = ? AND container_id != ''", models.StatusReady).Count(&activeContainers)

			c.JSON(200, gin.H{
				"total_projects":    projectCount,
				"total_deployments": deploymentCount,
				"active_containers": activeContainers,
			})
		})

		v1.POST("/projects", func(c *gin.Context) {
			var project models.Project
			if err := c.ShouldBindJSON(&project); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			if err := db.Create(&project).Error; err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			c.JSON(201, project)
		})

		v1.PUT("/projects/:id", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.First(&project, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}

			if err := c.ShouldBindJSON(&project); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}

			db.Save(&project)
			c.JSON(200, project)
		})

		v1.DELETE("/projects/:id", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.Preload("Deployments").First(&project, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}

			for _, d := range project.Deployments {
				if d.ContainerID != "" {
					orch.StopContainer(context.Background(), d.ContainerID)
					orch.RemoveContainer(context.Background(), d.ContainerID)
				}
			}

			db.Select("Deployments", "EnvVars", "Backups", "Volumes").Unscoped().Delete(&project)
			c.Status(204)
		})

		v1.POST("/projects/:id/env", func(c *gin.Context) {
			id := c.Param("id")
			var envVar models.EnvVar
			if err := c.ShouldBindJSON(&envVar); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			var project models.Project
			if err := db.First(&project, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}
			envVar.ProjectID = project.ID
			db.Create(&envVar)
			c.JSON(201, envVar)
		})

		v1.DELETE("/projects/:id/env/:envId", func(c *gin.Context) {
			envId := c.Param("envId")
			db.Delete(&models.EnvVar{}, envId)
			c.Status(204)
		})

		v1.POST("/projects/:id/volumes", func(c *gin.Context) {
			id := c.Param("id")
			var volume models.Volume
			if err := c.ShouldBindJSON(&volume); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			var project models.Project
			if err := db.First(&project, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}
			volume.ProjectID = project.ID
			db.Create(&volume)
			c.JSON(201, volume)
		})

		v1.DELETE("/projects/:id/volumes/:volumeId", func(c *gin.Context) {
			volumeId := c.Param("volumeId")
			db.Delete(&models.Volume{}, volumeId)
			c.Status(204)
		})

		v1.POST("/projects/:id/backups", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.Preload("Volumes").First(&project, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Project not found"})
				return
			}

			backup, err := handleBackup(db, project)
			if err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			c.JSON(201, backup)
		})

		v1.GET("/projects/:id/backups", func(c *gin.Context) {
			id := c.Param("id")
			var backups []models.Backup
			db.Where("project_id = ?", id).Find(&backups)
			c.JSON(http.StatusOK, backups)
		})

		v1.GET("/backups/:backupId/download", func(c *gin.Context) {
			backupId := c.Param("backupId")
			var backup models.Backup
			if err := db.First(&backup, backupId).Error; err != nil {
				c.JSON(404, gin.H{"error": "Backup not found"})
				return
			}

			c.File(backup.FilePath)
		})

		v1.POST("/projects/:id/deploy", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.Preload("EnvVars").Preload("Volumes").First(&project, id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
				return
			}

			cancelMutex.Lock()
			if cancel, exists := deploymentCancels[project.ID]; exists {
				cancel()
			}
			ctx, cancel := context.WithCancel(context.Background())
			deploymentCancels[project.ID] = cancel
			cancelMutex.Unlock()

			go handleDeploy(ctx, db, orch, hub, project)
			c.JSON(http.StatusAccepted, gin.H{"message": "Deployment started"})
		})

		v1.POST("/projects/:id/deploy/cancel", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.First(&project, id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
				return
			}

			cancelMutex.Lock()
			if cancel, exists := deploymentCancels[project.ID]; exists {
				cancel()
				delete(deploymentCancels, project.ID)
				cancelMutex.Unlock()

				var deployment models.Deployment
				db.Where("project_id = ? AND status = ?", project.ID, models.StatusBuilding).Order("id DESC").First(&deployment)
				if deployment.ID != 0 {
					updateDeploymentStatus(db, &deployment, models.StatusFailed, "Deployment cancelled by user.")
				}
				hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
				c.JSON(200, gin.H{"message": "Deployment cancelled"})
			} else {
				cancelMutex.Unlock()
				c.JSON(400, gin.H{"error": "No active deployment found to cancel"})
			}
		})

		v1.POST("/projects/:id/clear-data", func(c *gin.Context) {
			id := c.Param("id")
			var project models.Project
			if err := db.Preload("Deployments").First(&project, id).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
				return
			}

			for _, d := range project.Deployments {
				if d.ContainerID != "" {
					orch.StopContainer(context.Background(), d.ContainerID)
					orch.RemoveContainer(context.Background(), d.ContainerID)
				}
			}

			projectDir := filepath.Join("data", "projects", fmt.Sprintf("%d", project.ID))
			if err := os.RemoveAll(projectDir); err != nil {
				c.JSON(500, gin.H{"error": "Failed to delete project data: " + err.Error()})
				return
			}

			db.Model(&models.Deployment{}).Where("project_id = ?", project.ID).Update("status", "cleared")

			c.JSON(200, gin.H{"message": "Project data cleared successfully"})
		})

		v1.POST("/projects/:id/pause", func(c *gin.Context) {
			id := c.Param("id")
			var deployments []models.Deployment
			db.Where("project_id = ? AND container_id != ''", id).Order("id DESC").Find(&deployments)

			if len(deployments) > 0 {
				latest := &deployments[0]
				fmt.Printf("Pausing container %s for project %s\n", latest.ContainerID, id)
				err := orch.StopContainer(context.Background(), latest.ContainerID)

				if err == nil || strings.Contains(err.Error(), "already stopped") {
					latest.Status = models.StatusPaused
					latest.IsPaused = true
					db.Save(latest)
					hub.BroadcastStatus(latest.ProjectID, string(models.StatusPaused), latest.Port)
					c.JSON(200, gin.H{"message": "Project paused"})
					return
				} else if strings.Contains(err.Error(), "No such container") {
					latest.Status = models.StatusFailed
					latest.ContainerID = ""
					db.Save(latest)
					c.JSON(400, gin.H{"error": "Container no longer exists"})
					return
				} else {
					c.JSON(500, gin.H{"error": err.Error()})
					return
				}
			}
			c.JSON(400, gin.H{"error": "No running container found to pause"})
		})

		v1.POST("/projects/:id/resume", func(c *gin.Context) {
			id := c.Param("id")
			var deployments []models.Deployment
			db.Where("project_id = ? AND container_id != ''", id).Order("id DESC").Find(&deployments)

			if len(deployments) > 0 {
				latest := &deployments[0]
				fmt.Printf("Resuming container %s for project %s\n", latest.ContainerID, id)
				err := orch.StartContainer(context.Background(), latest.ContainerID)

				if err == nil || strings.Contains(err.Error(), "already started") {
					latest.Status = models.StatusReady
					latest.IsPaused = false
					db.Save(latest)
					hub.BroadcastStatus(latest.ProjectID, string(models.StatusReady), latest.Port)
					c.JSON(200, gin.H{"message": "Project resumed"})
					return
				} else if strings.Contains(err.Error(), "No such container") {
					latest.Status = models.StatusFailed
					latest.ContainerID = ""
					db.Save(latest)
					c.JSON(400, gin.H{"error": "Container no longer exists"})
					return
				} else {
					c.JSON(500, gin.H{"error": err.Error()})
					return
				}
			}
			c.JSON(400, gin.H{"error": "No paused container found to resume"})
		})
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3131"
	}
	log.Printf("Orchestro API starting on :%s", port)
	r.Run(":" + port)
}

func handleDeploy(ctx context.Context, db *gorm.DB, orch *orchestrator.DockerOrchestrator, hub *Hub, project models.Project) {
	defer func() {
		cancelMutex.Lock()
		if cancel, exists := deploymentCancels[project.ID]; exists {
			select {
			case <-ctx.Done():
				delete(deploymentCancels, project.ID)
			default:
			}
			_ = cancel
		}
		cancelMutex.Unlock()
	}()

	deployment := models.Deployment{
		ProjectID: project.ID,
		Status:    models.StatusBuilding,
	}
	db.Create(&deployment)
	hub.BroadcastStatus(project.ID, string(models.StatusBuilding), 0)

	select {
	case <-ctx.Done():
		updateDeploymentStatus(db, &deployment, models.StatusFailed, "Deployment cancelled.")
		return
	default:
	}

	projectBaseDir := filepath.Join("data", "projects")
	if _, err := os.Stat(projectBaseDir); os.IsNotExist(err) {
		os.MkdirAll(projectBaseDir, 0755)
	}

	projectDir := filepath.Join(projectBaseDir, fmt.Sprintf("%d", project.ID))

	if _, err := os.Stat(filepath.Join(projectDir, ".git")); os.IsNotExist(err) {
		fmt.Printf("Cloning %s into %s\n", project.RepoURL, projectDir)
		hub.BroadcastLogs(project.ID, "Cloning repository...\n")
		cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "-b", project.Branch, project.RepoURL, projectDir)
		if out, err := cmd.CombinedOutput(); err != nil {
			updateDeploymentStatus(db, &deployment, models.StatusFailed, "Git clone failed: "+string(out))
			hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
			return
		}
	} else {
		fmt.Printf("Updating repository in %s\n", projectDir)
		hub.BroadcastLogs(project.ID, "Updating repository...\n")
		cmd := exec.CommandContext(ctx, "git", "-C", projectDir, "fetch", "origin", project.Branch)
		if out, err := cmd.CombinedOutput(); err != nil {
			updateDeploymentStatus(db, &deployment, models.StatusFailed, "Git fetch failed: "+string(out))
			hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
			return
		}
		cmd = exec.CommandContext(ctx, "git", "-C", projectDir, "reset", "--hard", "origin/"+project.Branch)
		if out, err := cmd.CombinedOutput(); err != nil {
			updateDeploymentStatus(db, &deployment, models.StatusFailed, "Git reset failed: "+string(out))
			hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
			return
		}
	}

	select {
	case <-ctx.Done():
		updateDeploymentStatus(db, &deployment, models.StatusFailed, "Deployment cancelled.")
		return
	default:
	}

	workDir := projectDir
	if project.RootDirectory != "" {
		workDir = filepath.Join(projectDir, project.RootDirectory)
	}

	dockerfileName := "Dockerfile"
	dockerfilePath := filepath.Join(workDir, dockerfileName)

	var err error
	if project.CustomDockerfile != "" {
		fmt.Println("Using custom Dockerfile...")
		hub.BroadcastLogs(project.ID, "Using custom Dockerfile...\n")
		err = os.WriteFile(dockerfilePath, []byte(project.CustomDockerfile), 0644)
		if err != nil {
			updateDeploymentStatus(db, &deployment, models.StatusFailed, "Failed to write custom Dockerfile: "+err.Error())
			hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
			return
		}
	} else {
		installCmd := project.InstallCommand
		if installCmd == "" {
			installCmd = "bun install"
		}
		buildCmd := project.BuildCommand

		buildStep := ""
		if buildCmd != "" {
			buildStep = fmt.Sprintf("RUN %s", buildCmd)
		}

		startCmd := project.StartCommand
		if startCmd == "" {
			startCmd = "bun run start"
		}

		lockfile := "bun.lockb*"
		if _, err := os.Stat(filepath.Join(workDir, "bun.lock")); err == nil {
			lockfile = "bun.lock*"
		}

		var buildArgsList []string
		for _, ev := range project.EnvVars {
			buildArgsList = append(buildArgsList, fmt.Sprintf("ARG %s\nENV %s=$%s", ev.Key, ev.Key, ev.Key))
		}
		envInject := strings.Join(buildArgsList, "\n")

		intPort := project.InternalPort
		if intPort == 0 {
			intPort = 80
		}

		baseImage := project.BaseImage
		if baseImage == "" {
			baseImage = "oven/bun:latest"
		}

		copyStep := ""
		if _, err := os.Stat(filepath.Join(workDir, "package.json")); err == nil {
			copyStep = fmt.Sprintf("COPY package.json %s ./", lockfile)
		}

		dockerfileContent := fmt.Sprintf(`
FROM %s
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
%s
%s
RUN %s
COPY . .
%s
EXPOSE %d
CMD ["sh", "-c", "%s"]
`, baseImage, envInject, copyStep, installCmd, buildStep, intPort, startCmd)

		err = os.WriteFile(dockerfilePath, []byte(dockerfileContent), 0644)
		if err != nil {
			updateDeploymentStatus(db, &deployment, models.StatusFailed, "Failed to generate Dockerfile: "+err.Error())
			hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
			return
		}
	}

	imageName := fmt.Sprintf("orchestro-p%d", project.ID)

	buildArgs := make(map[string]*string)
	for _, ev := range project.EnvVars {
		val := ev.Value
		buildArgs[ev.Key] = &val
	}

	buildLogs, err := orch.BuildImage(ctx, workDir, imageName, dockerfileName, buildArgs, func(line string) {
		hub.BroadcastLogs(project.ID, line)
	})

	deployment.Logs = buildLogs
	if err != nil {
		updateDeploymentStatus(db, &deployment, models.StatusFailed, "Build failed: "+err.Error()+"\nLogs:\n"+buildLogs)
		hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
		return
	}
	db.Save(&deployment)

	select {
	case <-ctx.Done():
		updateDeploymentStatus(db, &deployment, models.StatusFailed, "Deployment cancelled.")
		return
	default:
	}

	var oldDeployments []models.Deployment
	db.Where("project_id = ? AND container_id != ''", project.ID).Find(&oldDeployments)
	for _, oldDep := range oldDeployments {
		fmt.Printf("Stopping old container %s for project %d\n", oldDep.ContainerID, project.ID)
		orch.StopContainer(context.Background(), oldDep.ContainerID)
		orch.RemoveContainer(context.Background(), oldDep.ContainerID)
		db.Model(&oldDep).Updates(map[string]interface{}{
			"container_id": "",
			"status":       "outdated",
		})
	}

	containerName := fmt.Sprintf("orchestro-c%d-%d", project.ID, deployment.ID)
	fmt.Printf("Starting container %s\n", containerName)
	hub.BroadcastLogs(project.ID, "Starting container...\n")

	port := project.CustomPort
	if port == 0 {
		port = 3000 + int(project.ID)
	}

	var env []string
	for _, ev := range project.EnvVars {
		env = append(env, fmt.Sprintf("%s=%s", ev.Key, ev.Value))
	}

	var volumes []string
	for _, v := range project.Volumes {
		fmt.Printf("Configuring volume: %s -> %s\n", v.HostPath, v.ContainerPath)
		volumes = append(volumes, fmt.Sprintf("%s:%s", v.HostPath, v.ContainerPath))
	}

	containerID, err := orch.RunContainer(ctx, imageName, containerName, port, project.InternalPort, env, volumes)
	if err != nil {
		if containerID != "" {
			orch.RemoveContainer(context.Background(), containerID)
		}
		updateDeploymentStatus(db, &deployment, models.StatusFailed, "Failed to run container: "+err.Error())
		hub.BroadcastStatus(project.ID, string(models.StatusFailed), 0)
		return
	}

	deployment.ContainerID = containerID
	deployment.Port = port
	updateDeploymentStatus(db, &deployment, models.StatusReady, deployment.Logs+"\nDeployment successful")
	hub.BroadcastStatus(project.ID, string(models.StatusReady), port)
	fmt.Printf("Project %d deployed successfully on port %d\n", project.ID, port)
}

func handleBackup(db *gorm.DB, project models.Project) (models.Backup, error) {
	backupDir := "data/backups"
	if _, err := os.Stat(backupDir); os.IsNotExist(err) {
		os.MkdirAll(backupDir, 0755)
	}

	timestamp := time.Now().Format("20060102-150405")
	tempDbPath := filepath.Join(os.TempDir(), fmt.Sprintf("orchestro-%s.db", timestamp))
	backupPath := filepath.Join(backupDir, fmt.Sprintf("backup-%d-%s.tar.gz", project.ID, timestamp))

	if err := db.Exec(fmt.Sprintf("VACUUM INTO '%s'", tempDbPath)).Error; err != nil {
		return models.Backup{}, fmt.Errorf("failed to vacuum database: %v", err)
	}
	defer os.Remove(tempDbPath)

	args := []string{"-czf", backupPath, "-C", filepath.Dir(tempDbPath), filepath.Base(tempDbPath)}

	for _, v := range project.Volumes {
		if _, err := os.Stat(v.HostPath); err == nil {
			args = append(args, v.HostPath)
		}
	}

	cmd := exec.Command("tar", args...)
	if err := cmd.Run(); err != nil {
		return models.Backup{}, fmt.Errorf("failed to create backup tar: %v", err)
	}

	fileInfo, _ := os.Stat(backupPath)
	backup := models.Backup{
		ProjectID: project.ID,
		CreatedAt: time.Now(),
		FilePath:  backupPath,
		Size:      fileInfo.Size(),
	}
	db.Create(&backup)

	return backup, nil
}

func updateDeploymentStatus(db *gorm.DB, d *models.Deployment, status models.DeploymentStatus, logs string) {
	d.Status = status
	d.Logs = logs
	db.Save(d)
}
