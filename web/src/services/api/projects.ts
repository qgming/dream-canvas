import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";
import { apiRequest, jsonRequest } from "./client";

type ProjectRecord = { id: string; title: string; version: number; document: Omit<CanvasProject, "id" | "title" | "version" | "createdAt" | "updatedAt">; createdAt: string; updatedAt: string };
const unpack = ({ document, ...record }: ProjectRecord): CanvasProject => ({ ...document, ...record });
const pack = ({ id, title, version, createdAt: _created, updatedAt: _updated, ...document }: CanvasProject) => ({ id, title, version, document });

export const listProjects = async () => (await apiRequest<ProjectRecord[]>("/projects")).map(unpack);
export const getProject = async (id: string) => unpack(await apiRequest<ProjectRecord>(`/projects/${encodeURIComponent(id)}`));
export const createProject = async (project: CanvasProject) => unpack(await apiRequest<ProjectRecord>("/projects", jsonRequest("POST", pack(project))));
export const saveProject = async (project: CanvasProject, operationId?: string) => unpack(await apiRequest<ProjectRecord>(`/projects/${encodeURIComponent(project.id)}`, jsonRequest("PUT", { ...pack(project), operationId })));
export const deleteProject = (id: string, version: number) => apiRequest<void>(`/projects/${encodeURIComponent(id)}`, jsonRequest("DELETE", { version }));
export const projectHistory = (id: string) => apiRequest<{ past: number[]; future: number[]; head: number }>(`/projects/${encodeURIComponent(id)}/history`);
export const revertProject = async (id: string, version: number, targetVersion: number) => unpack(await apiRequest<ProjectRecord>(`/projects/${encodeURIComponent(id)}/revert`, jsonRequest("POST", { version, targetVersion })));
export const taskProjectVersion = async (taskId: string, version: number) => {
    const record = await apiRequest<{ project: ProjectRecord; targetNode: CanvasNodeData; resultSlotId: string }>(`/tasks/${encodeURIComponent(taskId)}/project-version`, jsonRequest("POST", { version }));
    return { ...record, project: unpack(record.project) };
};

