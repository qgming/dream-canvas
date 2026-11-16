import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { createUser, listUsers, resetUserPassword, setUserDisabled, type User } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { captureSession } from "@/services/api/client";

export default function UsersPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const current = useAuthStore((state) => state.user);
    const users = useQuery({ queryKey: ["admin-users"], queryFn: listUsers });
    const [creating, setCreating] = useState(false);
    const [resetting, setResetting] = useState<User | null>(null);
    const [busy, setBusy] = useState(false);
    const run = async (action: () => Promise<unknown>, success: string) => {
        const assertSession = captureSession();
        setBusy(true);
        try { await action(); assertSession(); await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); assertSession(); message.success(success); return true; }
        catch (error) { message.error(error instanceof Error ? error.message : "操作失败"); return false; }
        finally { setBusy(false); }
    };
    return (
        <section className="space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-2xl font-medium tracking-tight">账号管理</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">创建账号、管理访问权限和重置密码。</p></div>
                <Space><Button type="text" icon={<RefreshCw className="size-4" />} loading={users.isFetching} onClick={() => void users.refetch()}>刷新</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>创建账号</Button></Space>
            </header>
            {users.error ? <Alert type="error" title={users.error.message} action={<Button onClick={() => void users.refetch()}>重试</Button>} /> : null}
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <Table<User> rowKey="id" loading={users.isLoading} dataSource={users.data} pagination={false} scroll={{ x: true }} columns={[
                    { title: "用户名", dataIndex: "username" },
                    { title: "角色", dataIndex: "role", render: (role) => <Tag>{role === "admin" ? "管理员" : "普通用户"}</Tag> },
                    { title: "状态", render: (_, user) => <Switch checked={!user.disabled} checkedChildren="启用" unCheckedChildren="停用" disabled={busy || user.id === current?.id} onChange={(enabled) => void run(() => setUserDisabled(user.id, !enabled), enabled ? "账号已启用" : "账号已停用，登录会话已撤销")} /> },
                    { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString("zh-CN") },
                    { title: "操作", render: (_, user) => <Button type="text" onClick={() => setResetting(user)}>重置密码</Button> },
                ]} />
            </div>
            <Modal title="创建账号" open={creating} onCancel={() => setCreating(false)} footer={null} destroyOnHidden>
                <Form layout="vertical" requiredMark={false} initialValues={{ role: "user" }} onFinish={async (input) => { if (await run(() => createUser(input), "账号已创建")) setCreating(false); }}>
                    <Form.Item name="username" label="用户名" rules={[{ required: true, whitespace: true, message: "请输入用户名" }]}><Input autoComplete="off" /></Form.Item>
                    <Form.Item name="password" label="初始密码" rules={[{ required: true, whitespace: true, message: "请输入密码" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Form.Item name="role" label="角色"><Select options={[{ value: "user", label: "普通用户" }, { value: "admin", label: "管理员" }]} /></Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy}>创建账号</Button>
                </Form>
            </Modal>
            <Modal title={`重置 ${resetting?.username || ""} 的密码`} open={Boolean(resetting)} onCancel={() => setResetting(null)} footer={null} destroyOnHidden>
                <Form layout="vertical" requiredMark={false} onFinish={async ({ password }) => {
                    if (!resetting) return;
                    const self = resetting.id === current?.id;
                    if (await run(() => resetUserPassword(resetting.id, password), "密码已重置，登录会话已撤销")) { setResetting(null); if (self) useAuthStore.getState().clear(); }
                }}>
                    <Form.Item name="password" label="新密码" rules={[{ required: true, whitespace: true, message: "请输入密码" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Space><Button onClick={() => setResetting(null)}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>重置密码</Button></Space>
                </Form>
            </Modal>
        </section>
    );
}
