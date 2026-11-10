const bcrypt = require('bcryptjs');
const { db } = require('./init');

const categories = [
  { name: 'Pencil Drawing', slug: 'pencil-drawing', sort_order: 1 },
  { name: 'Portrait Drawing', slug: 'portrait-drawing', sort_order: 2 },
  { name: 'Digital Art', slug: 'digital-art', sort_order: 3 },
  { name: 'Character Design', slug: 'character-design', sort_order: 4 },
  { name: 'Anime & Manga', slug: 'anime-manga', sort_order: 5 },
  { name: 'Sketching', slug: 'sketching', sort_order: 6 },
  { name: 'Watercolor', slug: 'watercolor', sort_order: 7 },
  { name: 'Oil Painting', slug: 'oil-painting', sort_order: 8 },
  { name: 'Landscape Drawing', slug: 'landscape-drawing', sort_order: 9 },
  { name: 'Abstract Art', slug: 'abstract-art', sort_order: 10 },
  { name: '3D Art', slug: '3d-art', sort_order: 11 },
  { name: 'Other Art', slug: 'other-art', sort_order: 12 }
];

function toMysqlDate(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

async function ensureSeeded() {
  const categoryRows = await db.execute('SELECT COUNT(*) AS count FROM categories');
  if (Number(categoryRows[0].count) === 0) {
    const insertCategory = 'INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)';
    for (const category of categories) {
      await db.execute(insertCategory, [category.name, category.slug, category.sort_order]);
    }
  }

  const userRows = await db.execute('SELECT COUNT(*) AS count FROM users');
  if (Number(userRows[0].count) === 0) {
    const adminPassword = bcrypt.hashSync('admin123', 10);
    const artistPassword = bcrypt.hashSync('artist123', 10);

    const insertUser = 'INSERT INTO users (username, email, password, name, bio, avatar, role, status, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())';

    await db.execute(insertUser, [
      'admin', 'admin@artspace.local', adminPassword,
      'ArtSpace Admin', 'Curating a space for artwork, creativity, and discovery.',
      '/images/default-avatar.svg', 'admin', 'active'
    ]);

    await db.execute(insertUser, [
      'mira', 'mira@artspace.local', artistPassword,
      'Mira Sol', 'Illustrator blending soft color stories and expressive portraits.',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
      'artist', 'active'
    ]);

    await db.execute(insertUser, [
      'glen', 'glen@artspace.local', artistPassword,
      'Glen Hart', 'Sketchbook-driven designer focusing on character and world-building.',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      'artist', 'active'
    ]);
  }

  const artworkRows = await db.execute('SELECT COUNT(*) AS count FROM artworks');
  if (Number(artworkRows[0].count) === 0) {
    const users = await db.execute('SELECT id, username FROM users ORDER BY id');
    const categoryRowsAll = await db.execute('SELECT id, slug FROM categories');
    const mapCat = {};
    for (const row of categoryRowsAll) {
      mapCat[row.slug] = row.id;
    }

    const insertArtwork = 'INSERT INTO artworks (user_id, category_id, title, description, tags, image_url, thumbnail_url, visibility, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

    const sampleArtworks = [
      {
        user: 'mira', category: 'portrait-drawing',
        title: 'Midnight Bloom', description: 'A portrait study exploring emotion through color and shadow.',
        tags: '#portrait #charcoal #emotion #softlight',
        image_url: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'glen', category: 'character-design',
        title: 'Neon Vanguard', description: 'A character concept designed around futuristic combat and motion.',
        tags: '#character #design #conceptart #cyber',
        image_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'mira', category: 'watercolor',
        title: 'Coastal Notes', description: 'A watercolor study based on layered washes and relaxed horizon lines.',
        tags: '#watercolor #landscape #mixedmedia #nature',
        image_url: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'glen', category: 'anime-manga',
        title: 'Rain Alley Pose', description: 'A manga-inspired scene built around motion, contrast, and atmosphere.',
        tags: '#anime #manga #ink #dynamic',
        image_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'mira', category: 'abstract-art',
        title: 'Silent Geometry', description: 'A balanced abstract composition using rhythm and negative spaces.',
        tags: '#abstract #geometry #minimal #color',
        image_url: 'https://images.unsplash.com/photo-1515405295579-ba7b45403062?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1515405295579-ba7b45403062?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'glen', category: 'digital-art',
        title: 'Forest Echo', description: 'A digital painting shaped by atmosphere, light, and mystery.',
        tags: '#digitalart #forest #mystery #painting',
        image_url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&q=80'
      }
    ];

    const now = new Date();

    for (const [index, artwork] of sampleArtworks.entries()) {
      const user = users.find((entry) => entry.username === artwork.user);
      if (!user) continue;
      await db.execute(insertArtwork, [
        user.id, mapCat[artwork.category], artwork.title, artwork.description,
        artwork.tags, artwork.image_url, artwork.thumbnail_url, 'public', 1,
        toMysqlDate(new Date(Date.now() - index * 86400000)), toMysqlDate(now)
      ]);
    }

    const artworkIds = await db.execute('SELECT id FROM artworks ORDER BY id');
    const mira = users.find((entry) => entry.username === 'mira');
    const glen = users.find((entry) => entry.username === 'glen');

    if (mira && glen) {
      const followSql = 'INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)';
      await db.execute(followSql, [mira.id, glen.id]);
      await db.execute(followSql, [glen.id, mira.id]);
    }

    const likeSql = 'INSERT IGNORE INTO likes (user_id, artwork_id) VALUES (?, ?)';
    for (let i = 0; i < Math.min(artworkIds.length, 4); i += 1) {
      if (mira) await db.execute(likeSql, [mira.id, artworkIds[i].id]);
      if (glen) await db.execute(likeSql, [glen.id, artworkIds[i].id]);
    }

    const bookmarkSql = 'INSERT IGNORE INTO bookmarks (user_id, artwork_id) VALUES (?, ?)';
    if (mira && artworkIds[0]) await db.execute(bookmarkSql, [mira.id, artworkIds[0].id]);

    const commentSql = 'INSERT INTO comments (artwork_id, user_id, body) VALUES (?, ?, ?)';
    if (artworkIds[0] && glen) {
      await db.execute(commentSql, [artworkIds[0].id, glen.id, 'This composition has an incredible sense of atmosphere.']);
    }
    if (artworkIds[1] && mira) {
      await db.execute(commentSql, [artworkIds[1].id, mira.id, 'The color and silhouette feel really premium.']);
    }
  }
}

if (require.main === module) {
  ensureSeeded().then(() => {
    console.log('Database seeded.');
    process.exit(0);
  }).catch((err) => {
    console.error('Error seeding database:', err);
    process.exit(1);
  });
}

module.exports = { ensureSeeded };
