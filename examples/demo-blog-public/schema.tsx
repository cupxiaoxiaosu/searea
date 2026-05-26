// @ts-nocheck
/** @jsxImportSource searea */

import {
  Database,
  Table,
  CharField,
  TextField,
  IntegerField,
  ForeignKey,
} from "searea";

import { demoAuth } from "./demo-auth.mjs";

/**
 * Blog demo JSX schema（SQLite + REST）。`writers` 表 REST 入口在 server 层关闭。
 * `onPost` 依赖 `demo-auth.mjs` 的 AsyncLocalStorage（由 server `authorize` 注入 writerId）。
 */
export default (
  <Database>
    <Table name="writers" admin={{ label: "Author", display_field: "username", order: 1 }}>
      <IntegerField name="id" primaryKey />
      <CharField name="username" maxLength={64} />
      <CharField
        name="password_plain"
        maxLength={128}
        null
        label="Demo password — do not reuse in production"
      />
      <CharField name="display_name" maxLength={128} />
      <TextField name="bio" null />
    </Table>
    <Table
      name="posts"
      admin={{ label: "Post", display_field: "title", order: 2 }}
      onPost={async ({ models: mm, instance }) => {
        const writerId = demoAuth.getStore()?.writerId;
        if (!writerId) return undefined;
        await mm.posts.objects.filter({ id: instance.id }).update({ writer: writerId });
        const obj = await mm.posts.objects.get({ id: instance.id });
        return await mm.posts.serialize(obj, { fkDepth: 0, expand: ["writer"] });
      }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="slug" maxLength={160} />
      <CharField name="title" maxLength={512} />
      <TextField name="excerpt" null />
      <TextField name="body_md" null label="Body (Markdown-ish)" />
      <CharField name="hero_tint" maxLength={32} null label="UI accent tint (hex slug)" />
      <IntegerField name="published_at_ms" null />
      <ForeignKey name="writer" relatedTable="writers" null />
    </Table>
    <Table
      name="comments"
      admin={{ label: "Comment", display_field: "body", order: 3 }}
      onPost={async ({ models: mm, instance }) => {
        const wid = demoAuth.getStore()?.writerId;
        if (!wid) return undefined;
        const wo = await mm.writers.objects.get({ id: wid });
        const fallbackNick = wo.display_name || wo.username || "guest";
        const nick =
          instance.nickname != null && String(instance.nickname).trim() !== ""
            ? String(instance.nickname)
            : fallbackNick;
        await mm.comments.objects.filter({ id: instance.id }).update({
          nickname: nick,
          created_ms: instance.created_ms ?? Date.now(),
        });
        const refreshed = await mm.comments.objects.get({ id: instance.id });
        return await mm.comments.serialize(refreshed, {
          fkDepth: 0,
          expand: ["post"],
        });
      }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="nickname" maxLength={128} null />
      <TextField name="body" null />
      <ForeignKey name="post" relatedTable="posts" />
      <IntegerField name="created_ms" null />
    </Table>
  </Database>
);
