/**
 * @param {{ chefs: *, recipes: *, recipe_lines: * }} m
 */
export async function seedRecipeDemo(m) {
  const chen = await m.chefs.objects.create({
    username: "alex",
    password_plain: "demo123",
    display_name: "Chen Alves",
  });

  const r1 = await m.recipes.objects.create({
    slug: "matcha-pot",
    title: "石锅抹茶炖饭",
    subtitle: "焦化边缘与清甜乳脂",
    cuisine: "fusion",
    duration_min: 45,
    servings: 4,
    story_md:
      "## 灵感\n抹茶的苦与米饭的焦糖层叠；慢煮让米粒仍弹牙。\n\n> 配菜可以换成渍姜或烤杏鲍菇。\n\n- **风险**：焦化过头发苦\n- **对策**：中小火耐心推锅",
    accent_from: "#064e3b",
    accent_to: "#34d399",
    chef: chen,
    created_ms: Date.now() - 86400000 * 12,
  });
  await m.recipe_lines.objects.create({
    recipe: r1,
    sort_order: 1,
    kind: "ingredient",
    text: "300g 糙米，提前浸泡 2 小时",
  });
  await m.recipe_lines.objects.create({
    recipe: r1,
    sort_order: 2,
    kind: "ingredient",
    text: "15g 茶道级抹茶粉 + 500ml 淡奶",
  });
  await m.recipe_lines.objects.create({
    recipe: r1,
    sort_order: 3,
    kind: "step",
    text: "铸铁锅底薄涂油，中小火烘出锅巴层，慢慢淋入奶浆。",
  });

  const r2 = await m.recipes.objects.create({
    slug: "ember-tomatoes",
    title: "余烬蕃茄焗豆",
    subtitle: "烟熏与鲜果酸的平衡木",
    cuisine: "comfort",
    duration_min: 60,
    servings: 6,
    story_md: "## Oven\n烤盘铺锡纸接住糖浆；咖啡豆壳熏香可选。",
    accent_from: "#7c2d12",
    accent_to: "#fb923c",
    chef: chen,
    created_ms: Date.now() - 86400000 * 4,
  });
  await m.recipe_lines.objects.create({
    recipe: r2,
    sort_order: 1,
    kind: "ingredient",
    text: "罐装白皮豆沥干水分",
  });
  await m.recipe_lines.objects.create({
    recipe: r2,
    sort_order: 2,
    kind: "step",
    text: "180°C / 35 分钟，中途淋枫糖一次",
  });

  const r3 = await m.recipes.objects.create({
    slug: "citrus-sable",
    title: "佛手柑千层酥屑",
    subtitle: "冷黄油与热浪相遇",
    cuisine: "sweet",
    duration_min: 90,
    servings: 8,
    story_md: "## Folding\n三折四次，冰箱冷藏足 20 分钟再擀。",
    accent_from: "#1e293b",
    accent_to: "#fcd34d",
    chef: chen,
    created_ms: Date.now() - 86400000,
  });
  await m.recipe_lines.objects.create({
    recipe: r3,
    sort_order: 1,
    kind: "ingredient",
    text: "黄油 260g （冷藏切丁）",
  });
  await m.recipe_lines.objects.create({
    recipe: r3,
    sort_order: 2,
    kind: "step",
    text: "200°C puff：先高温定型再降温烘透",
  });
}
