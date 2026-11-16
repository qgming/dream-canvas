import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input } from "antd";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { getAuthStatus } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";

export default function LoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const user = useAuthStore((state) => state.user);
    const signIn = useAuthStore((state) => state.signIn);
    const refresh = useAuthStore((state) => state.refresh);
    const [busy, setBusy] = useState(false);
    const status = useQuery({ queryKey: ["auth-status"], queryFn: getAuthStatus });
    const from = (location.state as { from?: string } | null)?.from;
    const target = from?.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login") ? from : "/canvas";
    useEffect(() => { void refresh(); }, [refresh]);
    if (user) return <Navigate to={target} replace />;

    const submit = async (values: { username: string; password: string }) => {
        setBusy(true);
        try { await signIn(values.username, values.password); navigate(target, { replace: true }); }
        catch (error) { message.error(error instanceof Error ? error.message : "登录失败"); }
        finally { setBusy(false); }
    };

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
            <div className="w-full max-w-sm py-12">
                <img src="/logo.svg" alt="" className="mb-8 size-9 dark:invert" />
                <h1 className="text-3xl font-medium tracking-tight">进入梦想画布</h1>
                <p className="mt-3 mb-8 text-sm text-muted-foreground">登录后继续你的项目与创作。</p>
                {status.error ? <Alert type="error" showIcon title="无法连接业务服务" description="请先启动 Go 服务，再重试。" action={<Button onClick={() => void status.refetch()}>重试</Button>} className="mb-6" /> : null}
                {status.data?.initialized === false ? <Alert type="info" showIcon title="请先初始化管理员" description="在服务器的 server 目录执行 go run ./cmd/server -init-admin admin，并在终端输入密码。" className="mb-6" /> : null}
                <Form layout="vertical" requiredMark={false} onFinish={submit}>
                    <Form.Item name="username" label="用户名" rules={[{ required: true, whitespace: true, message: "请输入用户名" }]}><Input autoComplete="username" autoFocus size="large" /></Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}><Input.Password autoComplete="current-password" size="large" /></Form.Item>
                    <Button type="primary" htmlType="submit" size="large" block loading={busy} disabled={!status.data?.initialized}>登录</Button>
                </Form>
                <p className="mt-6 text-xs leading-6 text-muted-foreground">账号由管理员创建。如需开通账号或重置密码，请联系管理员。</p>
            </div>
        </main>
    );
}
