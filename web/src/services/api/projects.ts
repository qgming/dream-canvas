import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { apiRequest, jsonRequest } from "./client";

type ProjectRecord = { id: string; title: string; version: number; document: Omit<CanvasProject, "id" | "title" | "version" | "createdAt" | "updatedAt">; createdAt: string; updatedAt: string };
const unpack = ({ document, ...record }: ProjectRecord): CanvasProject => ({ ...document, ...record });
const pack = ({ id, title, version, createdAt: _created, updatedAt: _updated, ...document }: CanvasProject) => ({ id, title, version, document });

export const listProjects = async () => (await apiRequest<ProjectRecord[]>("/projects")).map(unpack);
export const getProject = async (id: string) => unpack(await apiRequest<ProjectRecord>(`/projects/${encodeURIComponent(id)}`));
export const createProject = async (project: CanvasProject) => unpack(await apiRequest<ProjectRecord>("/projects", jsonRequest("POST", pack(project))));
export const saveProject = async (project: CanvasProject) => unpack(await apiRequest<ProjectRecord>(`/projects/${encodeURIComponent(project.id)}`, jsonRequest("PUT", pack(project))));

export type Approval = { id: string; action: "delete_project" | "delete_asset"; targetId: string; version: number; status: "pending" | "accepted" | "declined"; createdAt: string };
export const requestApproval = (action: Approval["action"], targetId: string, version = 0) => apiRequest<Approval>("/approvals", jsonRequest("POST", { action, targetId, version }));
export const decideApproval = (id: string, accept: boolean) => apiRequest<Approval | { approval: Approval; deleteState: string; message: string }>(`/approvals/${encodeURIComponent(id)}/decision`, jsonRequest("POST", { accept }));
