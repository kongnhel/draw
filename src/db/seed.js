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

function ensureSeeded() {
  const existingCategories = db.prepare('SELECT COUNT(*) AS count FROM categories').get();
  if (existingCategories.count === 0) {
    const insertCategory = db.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)');
    for (const category of categories) {
      insertCategory.run(category.name, category.slug, category.sort_order);
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (userCount.count === 0) {
    const adminPassword = bcrypt.hashSync('admin123', 10);
    const artistPassword = bcrypt.hashSync('artist123', 10);

    const insertUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, display_name, bio, avatar, cover_image, website, instagram, twitter, role, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run(
      'admin',
      'admin@artspace.local',
      adminPassword,
      'ArtSpace Admin',
      'Curating a space for artwork, creativity, and discovery.',
      '/uploads/avatars/default-avatar.png',
      '/uploads/covers/default-cover.jpg',
      'https://artspace.local',
      '@artspace',
      '@artspace',
      'admin',
      1
    );

    insertUser.run(
      'mira',
      'mira@artspace.local',
      artistPassword,
      'Mira Sol',
      'Illustrator blending soft color stories and expressive portraits.',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1515405295579-ba7b45403062?auto=format&fit=crop&w=1200&q=80',
      'https://behance.net',
      '@miraart',
      '@mira_art',
      'artist',
      1
    );

    insertUser.run(
      'glen',
      'glen@artspace.local',
      artistPassword,
      'Glen Hart',
      'Sketchbook-driven designer focusing on character and world-building.',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80',
      'https://instagram.com',
      '@glenhart',
      '@glenhart',
      'artist',
      1
    );
  }

  const artworkCount = db.prepare('SELECT COUNT(*) AS count FROM artworks').get();
  if (artworkCount.count === 0) {
    const users = db.prepare('SELECT id, username FROM users ORDER BY id').all();
    const categoriesMap = Object.fromEntries(
      db.prepare('SELECT id, slug FROM categories').all().map((item) => [item.slug, item.id])
    );

    const insertArtwork = db.prepare(`
      INSERT INTO artworks (user_id, category_id, title, description, tags, image_url, thumbnail_url, visibility, is_published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const sampleArtworks = [
      {
        user: 'mira',
        category: 'portrait-drawing',
        title: 'Midnight Bloom',
        description: 'A portrait study exploring emotion through color and shadow.',
        tags: '#portrait #charcoal #emotion #softlight',
        image_url: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'glen',
        category: 'character-design',
        title: 'Neon Vanguard',
        description: 'A character concept designed around futuristic combat and motion.',
        tags: '#character #design #conceptart #cyber',
        image_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'mira',
        category: 'watercolor',
        title: 'Coastal Notes',
        description: 'A watercolor study based on layered washes and relaxed horizon lines.',
        tags: '#watercolor #landscape #mixedmedia #nature',
        image_url: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'glen',
        category: 'anime-manga',
        title: 'Rain Alley Pose',
        description: 'A manga-inspired scene built around motion, contrast, and atmosphere.',
        tags: '#anime #manga #ink #dynamic',
        image_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'mira',
        category: 'abstract-art',
        title: 'Silent Geometry',
        description: 'A balanced abstract composition using rhythm and negative spaces.',
        tags: '#abstract #geometry #minimal #color',
        image_url: 'https://images.unsplash.com/photo-1515405295579-ba7b45403062?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1515405295579-ba7b45403062?auto=format&fit=crop&w=600&q=80'
      },
      {
        user: 'glen',
        category: 'digital-art',
        title: 'Forest Echo',
        description: 'A digital painting shaped by atmosphere, light, and mystery.',
        tags: '#digitalart #forest #mystery #painting',
        image_url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
        thumbnail_url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&q=80'
      }
    ];

    const now = new Date().toISOString();

    for (const [index, artwork] of sampleArtworks.entries()) {
      const user = users.find((entry) => entry.username === artwork.user);
      insertArtwork.run(
        user.id,
        categoriesMap[artwork.category],
        artwork.title,
        artwork.description,
        artwork.tags,
        artwork.image_url,
        artwork.thumbnail_url,
        'public',
        1,
        new Date(Date.now() - index * 86400000).toISOString(),
        now
      );
    }

    const followInsert = db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)');
    followInsert.run(users[1].id, users[2].id);
    followInsert.run(users[2].id, users[1].id);

    const likeInsert = db.prepare('INSERT OR IGNORE INTO likes (artwork_id, user_id) VALUES (?, ?)');
    const artworkIds = db.prepare('SELECT id FROM artworks ORDER BY id').all();
    for (let i = 0; i < Math.min(artworkIds.length, 4); i += 1) {
      likeInsert.run(artworkIds[i].id, users[1].id);
      likeInsert.run(artworkIds[i].id, users[2].id);
    }

    const commentInsert = db.prepare('INSERT INTO comments (artwork_id, user_id, body, created_at) VALUES (?, ?, ?, ?)');
    commentInsert.run(artworkIds[0].id, users[1].id, 'This composition has an incredible sense of atmosphere.', new Date().toISOString());
    commentInsert.run(artworkIds[1].id, users[2].id, 'The color and silhouette feel really premium.', new Date().toISOString());
  }
}

if (require.main === module) {
  ensureSeeded();
  console.log('Database seeded.');
}

module.exports = { ensureSeeded };
