import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense } from "react";

import UserLayout from "@/layouts/user-layout";
import SettingsLayout from "@/layouts/settings-layout";
import RequireAuth, { RequireAdmin } from "@/layouts/require-auth";
import LoginPage from "@/pages/login";
const GeneralSettingsPage = lazy(() => import("@/pages/settings/general"));
const AccountSettingsPage = lazy(() => import("@/pages/settings/account"));
const PreferencesPage = lazy(() => import("@/pages/settings/preferences"));
const PromptSourcesPage = lazy(() => import("@/pages/settings/prompt-sources"));
const ModelsPage = lazy(() => import("@/pages/settings/models"));
const AccessTokensPage = lazy(() => import("@/pages/settings/access-tokens"));
const ApprovalsPage = lazy(() => import("@/pages/settings/approvals"));
const UsersPage = lazy(() => import("@/pages/settings/users"));
const ChannelsPage = lazy(() => import("@/pages/settings/channels"));
const TasksPage = lazy(() => import("@/pages/tasks"));
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    {
        element: <RequireAuth />,
        children: [
            {
                element: <UserLayout><Outlet /></UserLayout>,
                children: [
                    { path: "/", element: <Navigate to="/canvas" replace /> },
                    { path: "/image", element: <ImagePage /> },
                    { path: "/video", element: <VideoPage /> },
                    { path: "/assets", element: <AssetsPage /> },
                    { path: "/prompts", element: <PromptsPage /> },
                    { path: "/canvas", element: <CanvasPage /> },
                    { path: "/canvas/:id", element: <CanvasProjectPage /> },
                    { path: "/settings", element: <SettingsLayout />, children: [
                        { index: true, element: <GeneralSettingsPage /> },
                        { path: "account", element: <AccountSettingsPage /> },
                        { path: "preferences", element: <PreferencesPage /> },
                        { path: "models", element: <ModelsPage /> },
                        { path: "prompt-sources", element: <PromptSourcesPage /> },
                        { path: "access-tokens", element: <AccessTokensPage /> },
                        { path: "approvals", element: <ApprovalsPage /> },
                        { element: <RequireAdmin />, children: [
                            { path: "users", element: <UsersPage /> },
                            { path: "channels", element: <ChannelsPage /> },
                        ] },
                    ] },
                    { path: "/tasks", element: <Suspense fallback={null}><TasksPage /></Suspense> },
                ],
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
