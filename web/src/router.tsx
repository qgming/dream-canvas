import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense } from "react";

import UserLayout from "@/layouts/user-layout";
import SettingsLayout from "@/layouts/settings-layout";
import RequireAuth, { RequireAdmin } from "@/layouts/require-auth";
import LoginPage from "@/pages/login";
import { Spinner } from "@/components/ui/display";
const GeneralSettingsPage = lazy(() => import("@/pages/settings/general"));
const AccountSettingsPage = lazy(() => import("@/pages/settings/account"));
const PreferencesPage = lazy(() => import("@/pages/settings/preferences"));
const InspirationPage = lazy(() => import("@/pages/inspiration"));
const ModelsPage = lazy(() => import("@/pages/settings/models"));
const AccessTokensPage = lazy(() => import("@/pages/settings/access-tokens"));
const ApprovalsPage = lazy(() => import("@/pages/settings/approvals"));
const UsersPage = lazy(() => import("@/pages/settings/users"));
const ChannelsPage = lazy(() => import("@/pages/settings/channels"));
const ModelScriptsPage = lazy(() => import("@/pages/settings/model-scripts"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const RuntimePage = lazy(() => import("@/pages/settings/runtime"));
const LoggingPage = lazy(() => import("@/pages/settings/logging"));
const StoragePage = lazy(() => import("@/pages/settings/storage"));
const UsagePage = lazy(() => import("@/pages/settings/usage"));
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PageError from "@/pages/error";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage />, errorElement: <PageError /> },
    {
        element: <RequireAuth />,
        errorElement: <PageError />,
        children: [
            {
                element: <UserLayout><Outlet /></UserLayout>,
                children: [
                    { path: "/", element: <Navigate to="/canvas" replace /> },
                    { path: "/image", element: <ImagePage /> },
                    { path: "/video", element: <VideoPage /> },
                    { path: "/assets", element: <AssetsPage /> },
                    { path: "/inspiration", element: <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}><InspirationPage /></Suspense> },
                    { path: "/canvas", element: <CanvasPage /> },
                    { path: "/canvas/:id", element: <CanvasProjectPage /> },
                    { path: "/settings", element: <SettingsLayout />, children: [
                        { index: true, element: <GeneralSettingsPage /> },
                        { path: "account", element: <AccountSettingsPage /> },
                        { path: "preferences", element: <PreferencesPage /> },
                        { path: "models", element: <ModelsPage /> },
                        { path: "access-tokens", element: <AccessTokensPage /> },
                        { path: "approvals", element: <ApprovalsPage /> },
                        { path: "usage", element: <UsagePage /> },
                        { element: <RequireAdmin />, children: [
                            { path: "users", element: <UsersPage /> },
                            { path: "channels", element: <ChannelsPage /> },
                            { path: "model-scripts", element: <ModelScriptsPage /> },
                            { path: "model-scripts/:id", element: <ModelScriptsPage /> },
                            { path: "runtime", element: <RuntimePage /> },
                            { path: "logging", element: <LoggingPage /> },
                            { path: "storage", element: <StoragePage /> },
                        ] },
                    ] },
                    { path: "/tasks", element: <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}><TasksPage /></Suspense> },
                ],
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
