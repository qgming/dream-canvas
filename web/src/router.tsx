import { createBrowserRouter, Outlet } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";

import UserLayout from "@/layouts/user-layout";
import SettingsLayout from "@/layouts/settings-layout";
import RequireAuth, { RequireAdmin, RequireWorkbench } from "@/layouts/require-auth";
import LoginPage from "@/pages/login";
import { Spinner } from "@/components/ui/display";
const GeneralSettingsPage = lazy(() => import("@/pages/settings/general"));
const BackupPage = lazy(() => import("@/pages/settings/backup"));
const AccountSettingsPage = lazy(() => import("@/pages/settings/account"));
const AboutPage = lazy(() => import("@/pages/settings/about"));
const InspirationPage = lazy(() => import("@/pages/inspiration"));
const ModelsPage = lazy(() => import("@/pages/settings/models"));
const AccessTokensPage = lazy(() => import("@/pages/settings/access-tokens"));
const UsersPage = lazy(() => import("@/pages/settings/users"));
const ChannelsPage = lazy(() => import("@/pages/settings/channels"));
const ModelScriptsPage = lazy(() => import("@/pages/settings/model-scripts"));
const CanvasPluginsPage = lazy(() => import("@/pages/settings/canvas-plugins"));
const TasksPage = lazy(() => import("@/pages/settings/tasks"));
const SitePage = lazy(() => import("@/pages/settings/site"));
const LoggingPage = lazy(() => import("@/pages/settings/logging"));
const StoragePage = lazy(() => import("@/pages/settings/storage"));
const AssetProjectPage = lazy(() => import("@/pages/assets"));
const AssetProjectsPage = lazy(() => import("@/pages/assets/overview"));
import CanvasPage from "@/pages/canvas";
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConversationsPage = lazy(() => import("@/pages/conversations"));
const ImagePage = lazy(() => import("@/pages/image"));
import NotFound from "@/pages/not-found";
import PageError from "@/pages/error";
const VideoPage = lazy(() => import("@/pages/video"));

const routeFallback = <div className="flex h-full items-center justify-center"><Spinner /></div>;
const lazyElement = (element: ReactNode) => <Suspense fallback={routeFallback}>{element}</Suspense>;

export const router = createBrowserRouter([
    { path: "/", element: <LoginPage />, errorElement: <PageError /> },
    { path: "/login", element: <LoginPage />, errorElement: <PageError /> },
    {
        element: <RequireAuth />,
        errorElement: <PageError />,
        children: [
            {
                element: <UserLayout><Outlet /></UserLayout>,
                children: [
                    { path: "/conversations", element: lazyElement(<ConversationsPage />) },
                    { path: "/image", element: <RequireWorkbench key="image" kind="image">{lazyElement(<ImagePage />)}</RequireWorkbench> },
                    { path: "/video", element: <RequireWorkbench key="video" kind="video">{lazyElement(<VideoPage />)}</RequireWorkbench> },
                    { path: "/assets", element: lazyElement(<AssetProjectsPage />) },
                    { path: "/assets/:projectId", element: lazyElement(<AssetProjectPage />) },
                    { path: "/inspiration", element: lazyElement(<InspirationPage />) },
                    { path: "/canvas", element: <CanvasPage /> },
                    { path: "/canvas/:id", element: lazyElement(<CanvasProjectPage />) },
                    { path: "/settings", element: <SettingsLayout />, children: [
                        { index: true, element: <GeneralSettingsPage /> },
                        { path: "backup", element: <BackupPage /> },
                        { path: "account", element: <AccountSettingsPage /> },
                        { path: "models", element: <ModelsPage /> },
                        { path: "access-tokens", element: <AccessTokensPage /> },
                        { path: "tasks", element: <TasksPage /> },
                        { path: "about", element: <AboutPage /> },
                        { element: <RequireAdmin />, children: [
                            { path: "users", element: <UsersPage /> },
                            { path: "channels", element: <ChannelsPage /> },
                            { path: "model-scripts", element: <ModelScriptsPage /> },
                            { path: "model-scripts/:id", element: <ModelScriptsPage /> },
                            { path: "canvas-plugins", element: <CanvasPluginsPage /> },
                            { path: "site", element: <SitePage /> },
                            { path: "logging", element: <LoggingPage /> },
                            { path: "storage", element: <StoragePage /> },
                        ] },
                    ] },
                ],
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
