import React from "react";
import { createRoot } from "react-dom/client";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { router } from "@/router";
import { applyAppTheme } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";

applyAppTheme(useThemeStore.getState().theme);

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
