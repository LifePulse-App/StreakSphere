import express from 'express';

const router = express.Router();

/**
 * Change these from DB/admin panel later
 */
const VERSION_POLICY = {
  android: {
    latestVersion: '6.2.0',
    minSupportedVersion: '6.1.0',
    updateUrl: 'https://play.google.com/store/apps/details?id=com.streaksphere',
    title: 'Update required',
    message: 'A new version is available. Please update your app to continue.',
  },
  ios: {
    latestVersion: '6.2.0',
    minSupportedVersion: '6.1.0',
    updateUrl: 'https://streaksphere.app/ios-beta.html',
    title: 'Update required',
    message: 'A new version is available. Please update your app to continue.',
  },
};

function cmp(a = '0.0.0', b = '0.0.0') {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

router.get('/version', async (req, res) => {
  try {
    const platform = String(req.query.platform || 'android').toLowerCase();
    const currentVersion = String(req.query.currentVersion || '0.0.0');
    

    // fallback: use android policy if platform unknown
    const policy = VERSION_POLICY[platform] || VERSION_POLICY.android;

    const updateAvailable = cmp(currentVersion, policy.latestVersion) < 0;
    const force = cmp(currentVersion, policy.minSupportedVersion) < 0;

    return res.json({
      ok: true,
      updateAvailable,
      force,
      latest: policy.latestVersion,                 // Matches frontend property "latest"
      minSupported: policy.minSupportedVersion,     // Matches frontend property "minSupported"
      updateUrl: policy.updateUrl,
      title: policy.title,
      message: policy.message,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'Failed to check version' });
  }
});

export default router;