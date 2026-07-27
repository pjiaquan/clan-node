import { performance } from 'perf_hooks';

// Mock BackupAvatar type
type BackupAvatar = {
  id: string;
  person_id: string;
  avatar_url: string;
  storage_key: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// Generate dummy data
const generateAvatars = (numPeople: number, avatarsPerPerson: number): BackupAvatar[] => {
  const avatars: BackupAvatar[] = [];
  for (let i = 0; i < numPeople; i++) {
    const person_id = `person_${i}`;
    for (let j = 0; j < avatarsPerPerson; j++) {
      avatars.push({
        id: `avatar_${i}_${j}`,
        person_id,
        avatar_url: `http://example.com/avatar/${i}/${j}.png`,
        storage_key: null,
        is_primary: j === 0, // Just an example
        sort_order: j,
        created_at: new Date(Date.now() - Math.random() * 100000).toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }
  // Shuffle avatars
  for (let i = avatars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [avatars[i], avatars[j]] = [avatars[j], avatars[i]];
  }
  return avatars;
};

const avatars = generateAvatars(5000, 3); // 15000 avatars total, 5000 people

const runOriginal = () => {
  const start = performance.now();
  // Pre-compute primary avatars
  const avatarPersonIds = [...new Set(avatars.map((avatar) => avatar.person_id))];
  const primaryAvatars = new Map<string, string | null>();
  for (const personId of avatarPersonIds) {
    const personAvatars = avatars.filter(a => a.person_id === personId);
    personAvatars.sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    primaryAvatars.set(personId, personAvatars[0]?.avatar_url ?? null);
  }
  const end = performance.now();
  console.log(`Original: ${end - start} ms`);
  return primaryAvatars;
};

const runOptimized = () => {
  const start = performance.now();

  // Group avatars by person_id
  const avatarsByPerson = new Map<string, BackupAvatar[]>();
  for (let i = 0; i < avatars.length; i++) {
    const avatar = avatars[i];
    let group = avatarsByPerson.get(avatar.person_id);
    if (!group) {
      group = [];
      avatarsByPerson.set(avatar.person_id, group);
    }
    group.push(avatar);
  }

  const primaryAvatars = new Map<string, string | null>();
  for (const [personId, personAvatars] of avatarsByPerson) {
    personAvatars.sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    primaryAvatars.set(personId, personAvatars[0]?.avatar_url ?? null);
  }

  const end = performance.now();
  console.log(`Optimized: ${end - start} ms`);
  return primaryAvatars;
};

// Warmup
runOriginal();
runOptimized();

console.log('--- Benchmarking ---');
runOriginal();
runOptimized();
