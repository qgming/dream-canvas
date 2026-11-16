import { App, Button, Form, Input } from "antd";
import { useState } from "react";

import { changePassword } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { captureSession } from "@/services/api/client";

export default function AccountSettingsPage() {
    const { message } = App.useApp();
    const user = useAuthStore((state) => state.user);
    const [saving, setSaving] = useState(false);
    const submit = async (values: { currentPassword: string; password: string }) => {
        const assertSession = captureSession();
        setSaving(true);
        try { await changePassword(values.currentPassword, values.password); assertSession(); message.success("密码已修改，请重新登录"); useAuthStore.getState().clear(); }
        catch (error) { message.error(error instanceof Error ? error.message : "修改失败"); }
        finally { setSaving(false); }
    };
    return (
        <section>
            <h2 className="text-2xl font-medium tracking-tight">账号与安全</h2>
            <p className="mt-2 mb-10 text-sm text-muted-foreground">{user?.username} · {user?.role === "admin" ? "管理员" : "普通用户"}</p>
            <section className="max-w-sm">
                <h3 className="mb-5 text-base font-medium">修改密码</h3>
                <Form layout="vertical" requiredMark={false} onFinish={submit}>
                    <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}><Input.Password autoComplete="current-password" /></Form.Item>
                    <Form.Item name="password" label="新密码" rules={[{ required: true, whitespace: true, message: "请输入新密码" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Form.Item name="confirm" label="确认新密码" dependencies={["password"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("两次密码不一致")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <p className="mb-5 text-xs text-muted-foreground">修改后将退出此账号的全部登录会话。</p>
                    <Button type="primary" htmlType="submit" loading={saving}>修改密码</Button>
                </Form>
            </section>
        </section>
    );
}
