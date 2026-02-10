package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/go-connections/nat"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/archive"
)

type DockerOrchestrator struct {
	cli *client.Client
}

func NewDockerOrchestrator() (*DockerOrchestrator, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &DockerOrchestrator{cli: cli}, nil
}

func (d *DockerOrchestrator) BuildImage(ctx context.Context, projectPath string, imageName string, dockerfileName string, buildArgs map[string]*string, onLog func(string)) (string, error) {
	fmt.Printf("Building image %s from %s with %s\n", imageName, projectPath, dockerfileName)
	
	tar, err := archive.TarWithOptions(projectPath, &archive.TarOptions{
		ExcludePatterns: []string{".git", "node_modules"},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create tar: %v", err)
	}

	opts := types.ImageBuildOptions{
		Dockerfile: dockerfileName,
		Tags:       []string{imageName},
		Remove:     true,
		ForceRemove: true,
		BuildArgs:  buildArgs,
	}

	res, err := d.cli.ImageBuild(ctx, tar, opts)
	if err != nil {
		return "", fmt.Errorf("docker build request failed: %v", err)
	}
	defer res.Body.Close()

	var buildLogs strings.Builder
	decoder := json.NewDecoder(res.Body)
	for {
		var msg struct {
			Stream string `json:"stream"`
			Error  string `json:"error"`
		}
		if err := decoder.Decode(&msg); err != nil {
			if err == io.EOF {
				break
			}
			return buildLogs.String(), fmt.Errorf("failed to decode build log: %v", err)
		}
		if msg.Stream != "" {
			if onLog != nil {
				onLog(msg.Stream)
			}
			buildLogs.WriteString(msg.Stream)
		}
		if msg.Error != "" {
			return buildLogs.String(), fmt.Errorf("docker build error: %s", msg.Error)
		}
	}

	return buildLogs.String(), nil
}

func (d *DockerOrchestrator) RunContainer(ctx context.Context, imageName string, containerName string, port int, internalPort int, env []string, volumes []string) (string, error) {
	if internalPort == 0 {
		internalPort = 80
	}
	containerPort := nat.Port(fmt.Sprintf("%d/tcp", internalPort))

	config := &container.Config{
		Image: imageName,
		Env:   env,
		ExposedPorts: nat.PortSet{
			containerPort: {},
		},
	}

	hostConfig := &container.HostConfig{
		Binds: volumes,
		PortBindings: nat.PortMap{
			containerPort: []nat.PortBinding{
				{
					HostIP:   "0.0.0.0",
					HostPort: fmt.Sprintf("%d", port),
				},
			},
		},
	}

	resp, err := d.cli.ContainerCreate(ctx, config, hostConfig, nil, nil, containerName)
	if err != nil {
		return "", err
	}

	if err := d.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return resp.ID, err
	}

	return resp.ID, nil
}

func (d *DockerOrchestrator) GetContainerLogs(ctx context.Context, containerID string) (io.ReadCloser, error) {
	options := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     false,
		Tail:       "100",
	}
	return d.cli.ContainerLogs(ctx, containerID, options)
}

func (d *DockerOrchestrator) GetContainerStatus(ctx context.Context, containerID string) (string, error) {
	inspect, err := d.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return "", err
	}
	return inspect.State.Status, nil
}

func (d *DockerOrchestrator) GetContainerStats(ctx context.Context, containerID string) (uint64, uint64, error) {
	stats, err := d.cli.ContainerStats(ctx, containerID, false)
	if err != nil {
		return 0, 0, err
	}
	defer stats.Body.Close()

	var v struct {
		MemoryStats struct {
			Usage uint64 `json:"usage"`
		} `json:"memory_stats"`
		CPUStats struct {
			CPUUsage struct {
				TotalUsage uint64 `json:"total_usage"`
			} `json:"cpu_usage"`
			SystemUsage uint64 `json:"system_cpu_usage"`
		} `json:"cpu_stats"`
	}
	if err := json.NewDecoder(stats.Body).Decode(&v); err != nil {
		return 0, 0, err
	}

	return v.MemoryStats.Usage, v.CPUStats.CPUUsage.TotalUsage, nil
}

func (d *DockerOrchestrator) StartContainer(ctx context.Context, containerID string) error {
	return d.cli.ContainerStart(ctx, containerID, container.StartOptions{})
}

func (d *DockerOrchestrator) StopContainer(ctx context.Context, containerID string) error {
	return d.cli.ContainerStop(ctx, containerID, container.StopOptions{})
}

func (d *DockerOrchestrator) RemoveContainer(ctx context.Context, containerID string) error {
	return d.cli.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true})
}

// We will add more methods here like BuildImage, RunContainer, StopContainer
