/**
 * @param {{ writers: *, posts: *, comments: * }} m
 */
export async function seedBlogDemo(m) {
  const alex = await m.writers.objects.create({
    username: "alex",
    password_plain: "demo123",
    display_name: "Alex Rivera",
    bio: "Design systems & shoreline photography.",
  });
  await m.writers.objects.create({
    username: "mika",
    password_plain: "demo123",
    display_name: "Mika Tan",
    bio: "Tea, typography, trains.",
  });

  const now = Date.now();
  const ocean = await m.posts.objects.create({
    slug: "ocean-light",
    title: "Reading light on an empty pier",
    excerpt: "Where the harbor thins into silver thread, shutters slow down.",
    body_md:
      "## Morning\n\nStacks of gulls reorganize themselves when the tram passes.\n\n- Salt on the railing\n- A notebook full of tides\n\n> Silence is louder when you name it.",
    hero_tint: "#C45C3E",
    published_at_ms: now - 86400000 * 10,
    writer: alex,
  });
  await m.posts.objects.create({
    slug: "linen-typescript",
    title: "Why we keep a handwritten changelog",
    excerpt: "Paper trails teach teams to speak in complete sentences.",
    body_md:
      "## Cadence\n\nEvery Friday we distill three bullets — **risk**, **joy**, **debt**.\n\nNothing ships without brushing ink across the margins once.",
    hero_tint: "#1e3a5f",
    published_at_ms: now - 86400000 * 5,
    writer: alex,
  });
  const teaPost = await m.posts.objects.create({
    slug: "tea-map",
    title: "Mapping cities by their slowest elevators",
    excerpt: "An index of patience: hotel lobbies, libraries, dusk.",
    body_md:
      "## Field notes\n\n1. Elevator mirrors smooth anxiety.\n2. Lobby plants never lie about humidity.",
    hero_tint: "#3d3428",
    published_at_ms: now - 86400000 * 3,
    writer: alex,
  });

  await m.comments.objects.create({
    nickname: "river",
    body: "The pier paragraph stayed with me all week.",
    post: ocean,
    created_ms: now - 7200000,
  });
  await m.comments.objects.create({
    nickname: "linen",
    body: "Printed this for our retro wall.",
    post: teaPost,
    created_ms: now - 3600000,
  });
}
