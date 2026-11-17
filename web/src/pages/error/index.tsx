import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export default function PageError() {
    const { t } = useTranslation();
    return <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground"><section role="alert" className="max-w-md space-y-4"><h1 className="text-2xl font-semibold">{t("ui.pageError")}</h1><p className="text-sm leading-6 text-muted-foreground">{t("ui.pageErrorDescription")}</p><div className="flex flex-wrap gap-2"><Button variant="default" icon={<RefreshCw />} onClick={() => location.reload()}>{t("workspace.reload")}</Button><Button asChild><Link to="/canvas" reloadDocument>{t("notFound.home")}</Link></Button></div></section></main>;
}
