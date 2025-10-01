// ---- Main update ----
async function updateBreakingFeed() {
  console.log('Fetching articles...');
  const articles = await fetchArticlesFromFeeds(feedUrls);
  console.log(`📰 Articles fetched: ${articles.length}`);

  console.log('Fetching videos...');
  const videos = await fetchVideosForChannels(CHANNEL_IDS);
  console.log(`🎬 Videos fetched total: ${videos.length}`);

  const existingSnap = await db.collection('breaking_news').get();
  const existingIds = new Set(existingSnap.docs.map((doc) => doc.id));

  const newVideos = videos.filter((item) => {
    const safeId = crypto
      .createHash('md5')
      .update(item.videoId || item.url || item.title)
      .digest('hex');
    return !existingIds.has(safeId);
  });

  console.log(
    `🆕 New unique videos to insert: ${newVideos.length} (out of ${videos.length})`
  );

  // Combine all items and sort by newest
  const combined = [...articles, ...newVideos].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  // ---- Insert latest items ----
  const batch = db.batch();
  combined.forEach((item) => {
    const safeId = crypto
      .createHash('md5')
      .update(item.videoId || item.url || item.title)
      .digest('hex');
    const ref = db.collection('breaking_news').doc(safeId);

    const payload = {
      title: item.title,
      description: item.description,
      url: item.url,
      image: item.image,
      type: item.type,
      source: item.source || 'Unknown',
      timestamp: admin.firestore.Timestamp.fromDate(new Date(item.timestamp)),
    };

    if (item.type === 'video') {
      payload.videoId = item.videoId;
      payload.views = item.views;
    }

    batch.set(ref, payload, { merge: true });
  });
  await batch.commit();

  console.log(
    `✅ Updated breaking_news with ${articles.length} new articles + ${newVideos.length} new videos`
  );

  // ---- Enforce max 30 docs ----
  const snap = await db
    .collection('breaking_news')
    .orderBy('timestamp', 'desc')
    .get();

  if (snap.size > 30) {
    console.log(`⚠️ breaking_news has ${snap.size} docs, deleting oldest...`);
    const docsToDelete = snap.docs.slice(30); // keep only top 30
    const delBatch = db.batch();
    docsToDelete.forEach((doc) => delBatch.delete(doc.ref));
    await delBatch.commit();
    console.log(`🗑️ Deleted ${docsToDelete.length} old docs, kept latest 30`);
  }

  await sendTopVideoIfNeeded(newVideos);
}
