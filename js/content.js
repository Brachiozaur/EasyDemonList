import { round, score } from './score.js';

/**
 * Path to directory containing `_list.json` and all levels
 */
const dir = '/data';

export async function fetchList() {
  // Load pack definitions once
  const packs = await fetchPacks(); // returns null or array
  const levelToPacks = {};

  if (packs) {
    packs.forEach(pack => {
      (pack.levels ?? []).forEach(levelId => {
        (levelToPacks[levelId] ??= []).push({
          name: pack.name,
          colour: pack.colour,
        });
      });
    });
  }

  const listResult = await fetch(`${dir}/_list.json`);
  try {
    const list = await listResult.json();
    return await Promise.all(
      list.map(async (path, rank) => {
        const levelResult = await fetch(`${dir}/${path}.json`);
        try {
          const level = await levelResult.json();
          return [
            {
              ...level,
              path,
              // Inject pack membership for the level (empty if none / packs failed)
              packs: levelToPacks[path] ?? [],
              records: (level.records ?? [])
                .map(({ hz, ...rest }) => rest) // keep EDL behavior
                .sort((a, b) => b.percent - a.percent),
            },
            null,
          ];
        } catch {
          console.error(`Failed to load level #${rank + 1} ${path}.`);
          return [null, path];
        }
      }),
    );
  } catch {
    console.error(`Failed to load list.`);
    return null;
  }
}

export async function fetchEditors() {
  try {
    const editorsResults = await fetch(`${dir}/_editors.json`);
    const editors = await editorsResults.json();
    return editors;
  } catch {
    return null;
  }
}

export async function fetchLeaderboard() {
  const list = await fetchList();

  if (!list) return null;

  const scoreMap = {};
  const errs = [];

  list.forEach(([level, err], rank) => {
    if (err) {
      errs.push(err);
      return;
    }

    // Verification
    const verifier =
      Object.keys(scoreMap).find((u) => u.toLowerCase() === level.verifier.toLowerCase()) ||
      level.verifier;

    scoreMap[verifier] ??= { verified: [], completed: [], progressed: [] };

    scoreMap[verifier].verified.push({
      rank: rank + 1,
      level: level.name,
      score: score(rank + 1, 100, level.percentToQualify),
      link: level.verification,
    });

    // Records
    level.records.forEach((record) => {
      const user =
        Object.keys(scoreMap).find((u) => u.toLowerCase() === record.user.toLowerCase()) ||
        record.user;

      scoreMap[user] ??= { verified: [], completed: [], progressed: [] };

      if (record.percent === 100) {
        scoreMap[user].completed.push({
          rank: rank + 1,
          level: level.name,
          levelPath: level.path, // IMPORTANT for pack completion
          score: score(rank + 1, 100, level.percentToQualify),
          link: record.link,
        });
        return;
      }

      scoreMap[user].progressed.push({
        rank: rank + 1,
        level: level.name,
        levelPath: level.path, // optional, but keep consistent
        percent: record.percent,
        score: score(rank + 1, record.percent, level.percentToQualify),
        link: record.link,
      });
    });
  });

  // Wrap in extra Object containing the user and total score
  const res = Object.entries(scoreMap).map(([user, scores]) => {
    const { verified, completed, progressed } = scores;
    const total = [verified, completed, progressed].flat().reduce((prev, cur) => prev + cur.score, 0);

    return {
      user,
      total: round(total),
      packs: [],
      ...scores,
    };
  });

  /* ================= PACK COMPLETION ================= */

  const packs = await fetchPacks(); // uses _packlist.json

  if (packs) {
    res.forEach((player) => {
      const completedIds = new Set(
        (player.completed ?? []).map((l) => l.levelPath).filter(Boolean)
      );

      player.packs = packs.filter((pack) => {
        const levels = pack.levels ?? [];
        if (levels.length === 0) return false;
        return levels.every((levelId) => completedIds.has(levelId));
      });
    });
  } else {
    res.forEach((player) => (player.packs = []));
  }

  /* =================================================== */

  // Sort by total score
  return [res.sort((a, b) => b.total - a.total), errs];
}

export async function fetchPacks() {
  try {
    const res = await fetch(`${dir}/_packlist.json`);
    return await res.json(); // array of {name, levels, colour}
  } catch {
    return null;
  }
}

export async function fetchPackLevels(packName) {
  try {
    const packs = await fetchPacks();
    if (!packs) return null;

    const pack = packs.find((p) => p.name === packName);
    if (!pack) return null;

    return await Promise.all(
      (pack.levels ?? []).map(async (path, idx) => {
        try {
          const levelRes = await fetch(`${dir}/${path}.json`);
          const level = await levelRes.json();

          return [
            {
              level: {
                ...level,
                path,
                // optional: also inject pack membership for pack-page levels
                records: (level.records ?? [])
                  .map(({ hz, ...rest }) => rest) // keep EDL behavior
                  .sort((a, b) => b.percent - a.percent),
              },
            },
            null,
          ];
        } catch {
          console.error(`Failed to load pack level #${idx + 1}: ${path}.json`);
          return [null, path];
        }
      }),
    );
  } catch {
    return null;
  }
}
