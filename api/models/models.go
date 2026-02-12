package models

import (
	"time"

	"gorm.io/gorm"
)

type Project struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
	Name             string         `gorm:"uniqueIndex;not null" json:"name"`
	RepoURL          string         `json:"repo_url"`
	Branch           string         `json:"branch" gorm:"default:'main'"`
	RootDirectory    string         `json:"root_directory" gorm:"default:''"`
	BuildCommand     string         `json:"build_command"`
	InstallCommand   string         `json:"install_command"`
	StartCommand     string         `json:"start_command" gorm:"default:'bun run start'"`
	OutputDirectory  string         `json:"output_directory" gorm:"default:'dist'"`
	CustomPort       int            `json:"custom_port"`
	InternalPort     int            `json:"internal_port" gorm:"default:80"`
	EnvVars          []EnvVar       `json:"env_vars" gorm:"foreignKey:ProjectID"`
	Deployments      []Deployment   `json:"deployments" gorm:"foreignKey:ProjectID"`
	Backups          []Backup       `json:"backups" gorm:"foreignKey:ProjectID"`
	Volumes          []Volume       `json:"volumes" gorm:"foreignKey:ProjectID"`
	WebhookSecret    string         `json:"webhook_secret"`
	GitProvider      string         `json:"git_provider"` // "github" or "gitlab"
	WebhookBranch    string         `json:"webhook_branch"`
	DockerCompose    string         `json:"docker_compose" gorm:"type:text"`
	CustomDockerfile string         `json:"custom_dockerfile" gorm:"type:text"`
}

type EnvVar struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	ProjectID uint   `json:"project_id"`
	Key       string `json:"key"`
	Value     string `json:"value"`
}

type Backup struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ProjectID uint      `json:"project_id"`
	CreatedAt time.Time `json:"created_at"`
	FilePath  string    `json:"file_path"`
	Size      int64     `json:"size"`
}

type Volume struct {
	ID            uint   `gorm:"primaryKey" json:"id"`
	ProjectID     uint   `json:"project_id"`
	HostPath      string `json:"host_path"`
	ContainerPath string `json:"container_path"`
}

type DeploymentStatus string

const (
	StatusPending   DeploymentStatus = "pending"
	StatusBuilding  DeploymentStatus = "building"
	StatusReady     DeploymentStatus = "ready"
	StatusFailed    DeploymentStatus = "failed"
	StatusPaused    DeploymentStatus = "paused"
	StatusCancelled DeploymentStatus = "cancelled"
)

type Deployment struct {
	ID          uint             `gorm:"primaryKey" json:"id"`
	ProjectID   uint             `json:"project_id"`
	CreatedAt   time.Time        `json:"created_at"`
	Status      DeploymentStatus `json:"status"`
	CommitHash  string           `json:"commit_hash"`
	Logs        string           `json:"logs" gorm:"type:text"`
	ContainerID string           `json:"container_id"`
	Port        int              `json:"port"`
	IsPaused    bool             `json:"is_paused"`
}
