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

function resolveRecipeFkId(_mm, recipeVal) {
  if (recipeVal == null) return null;
  if (typeof recipeVal === "object" && "id" in recipeVal) return recipeVal.id;
  return Number(recipeVal);
}

/** Recipes demo JSX schema — `/api/chefs` 在 server 层关闭 */
export default (
  <Database>
    <Table name="chefs" admin={{ label: "Chef", display_field: "username", order: 1 }}>
      <IntegerField name="id" primaryKey />
      <CharField name="username" maxLength={64} />
      <CharField name="password_plain" maxLength={128} null />
      <CharField name="display_name" maxLength={128} />
    </Table>
    <Table
      name="recipes"
      admin={{ label: "Recipe", display_field: "title", order: 2 }}
      onPost={async ({ models: mm, instance }) => {
        const cid = demoAuth.getStore()?.chefId;
        if (!cid) return undefined;
        await mm.recipes.objects.filter({ id: instance.id }).update({
          chef: cid,
          created_ms: instance.created_ms ?? Date.now(),
        });
        const obj = await mm.recipes.objects.get({ id: instance.id });
        return await mm.recipes.serialize(obj, { fkDepth: 0, expand: ["chef"] });
      }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="slug" maxLength={160} />
      <CharField name="title" maxLength={320} />
      <CharField name="subtitle" maxLength={512} null />
      <CharField name="cuisine" maxLength={64} null />
      <IntegerField name="duration_min" null />
      <IntegerField name="servings" null />
      <TextField name="story_md" null />
      <CharField name="accent_from" maxLength={16} null />
      <CharField name="accent_to" maxLength={16} null />
      <ForeignKey name="chef" relatedTable="chefs" null />
      <IntegerField name="created_ms" null />
    </Table>
    <Table
      name="recipe_lines"
      admin={{ label: "Line", display_field: "text", order: 3 }}
      onPost={async ({ models: mm, instance }) => {
        const recipeId = resolveRecipeFkId(mm, instance.recipe);
        if (!recipeId) return undefined;
        let nextOrder = Number(instance.sort_order);
        if (!Number.isFinite(nextOrder)) {
          const rows = await mm.recipe_lines.objects
            .filter({ recipe: recipeId })
            .orderBy("-sort_order")
            .limit(1)
            .values({ fkDepth: 0 });
          const cur = rows[0]?.sort_order ?? 0;
          nextOrder = Number(cur) + 1;
        }
        const kind =
          instance.kind != null && String(instance.kind).trim() !== ""
            ? String(instance.kind)
            : "ingredient";
        await mm.recipe_lines.objects.filter({ id: instance.id }).update({
          recipe: recipeId,
          sort_order: nextOrder,
          kind,
        });
        const line = await mm.recipe_lines.objects.get({ id: instance.id });
        return await mm.recipe_lines.serialize(line, {
          fkDepth: 0,
          expand: ["recipe"],
        });
      }}
    >
      <IntegerField name="id" primaryKey />
      <ForeignKey name="recipe" relatedTable="recipes" />
      <IntegerField name="sort_order" null />
      <TextField name="text" null />
      <CharField name="kind" maxLength={16} null label="ingredient | step" />
    </Table>
  </Database>
);
