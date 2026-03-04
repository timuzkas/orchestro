package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	pingPeriod = 30 * time.Second
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan []byte
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
	mu         sync.Mutex
}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan []byte),
		register:   make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
		clients:    make(map[*websocket.Conn]bool),
	}
}

func (h *Hub) run() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.Close()
			}
			h.mu.Unlock()
		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				err := client.WriteMessage(websocket.TextMessage, message)
				if err != nil {
					client.Close()
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		case <-ticker.C:
			h.mu.Lock()
			for client := range h.clients {
				if err := client.WriteMessage(websocket.PingMessage, nil); err != nil {
					client.Close()
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) BroadcastStatus(projectID uint, status string, port int) {
	msg, _ := json.Marshal(map[string]interface{}{
		"type":       "status",
		"project_id": projectID,
		"status":     status,
		"port":       port,
	})
	h.broadcast <- msg
}

func (h *Hub) BroadcastLogs(projectID uint, logLine string) {
	msg, _ := json.Marshal(map[string]interface{}{
		"type":       "log",
		"project_id": projectID,
		"log":        logLine,
	})
	h.broadcast <- msg
}

func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Printf("Error upgrading to websocket: %v\n", err)
		return
	}
	hub.register <- conn

	go func() {
		defer func() { hub.unregister <- conn }()
		for {
			// Read loop is required to handle pong responses and detect disconnects
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}
