package app

import (
	"context"
	"sync"
)

// A saved policy may change the limit while existing streams finish normally.
type fileGate struct { mu sync.Mutex; used, priority int; changed chan struct{} }

func newFileGate() *fileGate { return &fileGate{changed: make(chan struct{})} }

func (g *fileGate) notify() { close(g.changed); g.changed = make(chan struct{}) }

func (a *App) acquireFile(ctx context.Context, preview, priority bool) (func(), error) {
	gate := a.transfers; if preview { gate = a.previews }
	gate.mu.Lock()
	if priority { gate.priority++ }
	for {
		limit := 1
		if policy, err := a.executionPolicy(); err == nil { limit = policy.TransferSlots; if preview { limit = policy.PreviewSlots } }
		if gate.used < limit && (priority || gate.priority == 0) {
			if priority { gate.priority-- }; gate.used++; gate.mu.Unlock()
			var once sync.Once
			return func() { once.Do(func() { gate.mu.Lock(); gate.used--; gate.notify(); gate.mu.Unlock() }) }, nil
		}
		changed := gate.changed; gate.mu.Unlock()
		select { case <-ctx.Done(): gate.mu.Lock(); if priority { gate.priority-- }; gate.notify(); gate.mu.Unlock(); return nil, ctx.Err(); case <-changed: }
		gate.mu.Lock()
	}
}

func (a *App) wakeFiles() { for _, gate := range []*fileGate{a.transfers, a.previews} { gate.mu.Lock(); gate.notify(); gate.mu.Unlock() } }
