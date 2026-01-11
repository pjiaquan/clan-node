export const ZODIAC_ANIMALS = [
  '猴', '雞', '狗', '豬', '鼠', '牛', '虎', '兔', '龍', '蛇', '馬', '羊'
];

const HEAVENLY_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const EARTHLY_BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

export function getZodiacAnimal(year: number): string {
  // 1900 was Year of the Rat. 1900 % 12 = 4.
  // Rat is index 4 in my array? No.
  // Rat is usually start.
  // Let's use a standard offset.
  // 1924 = Rat. 1924 % 12 = 4.
  // Array: Rat, Ox, Tiger, Rabbit, Dragon, Snake, Horse, Goat, Monkey, Rooster, Dog, Pig
  // If we want to use % 12 directly:
  // 0: Monkey, 1: Rooster, 2: Dog, 3: Pig, 4: Rat ...
  // This matches standard remainder logic.
  return ZODIAC_ANIMALS[year % 12];
}

export function getGanzhiYear(year: number): string {
  const baseYear = 1984; // 1984 is 甲子
  const offset = ((year - baseYear) % 60 + 60) % 60;
  const stem = HEAVENLY_STEMS[offset % 10];
  const branch = EARTHLY_BRANCHES[offset % 12];
  return `${stem}${branch}`;
}

export const TRADITIONAL_HOURS = [
  { name: '子時', start: 23, end: 1, range: '23:00-01:00' },
  { name: '丑時', start: 1, end: 3, range: '01:00-03:00' },
  { name: '寅時', start: 3, end: 5, range: '03:00-05:00' },
  { name: '卯時', start: 5, end: 7, range: '05:00-07:00' },
  { name: '辰時', start: 7, end: 9, range: '07:00-09:00' },
  { name: '巳時', start: 9, end: 11, range: '09:00-11:00' },
  { name: '午時', start: 11, end: 13, range: '11:00-13:00' },
  { name: '未時', start: 13, end: 15, range: '13:00-15:00' },
  { name: '申時', start: 15, end: 17, range: '15:00-17:00' },
  { name: '酉時', start: 17, end: 19, range: '17:00-19:00' },
  { name: '戌時', start: 19, end: 21, range: '19:00-21:00' },
  { name: '亥時', start: 21, end: 23, range: '21:00-23:00' },
];

const findTraditionalByHour = (hour: number) => {
  if (hour >= 23 || hour < 1) return TRADITIONAL_HOURS[0];
  return TRADITIONAL_HOURS.find(h => h.name !== '子時' && hour >= h.start && hour < h.end) || null;
};

export function getTraditionalHour(value: string): string {
  if (!value) return '';
  if (!value.includes(':')) {
    return TRADITIONAL_HOURS.some(h => h.name === value) ? value : '';
  }
  const [hourStr] = value.split(':');
  const hour = parseInt(hourStr, 10);
  const match = findTraditionalByHour(hour);
  return match ? match.name : '';
}

export function getModernTimeRange(value: string): string {
  if (!value) return '';
  const name = getTraditionalHour(value);
  const match = TRADITIONAL_HOURS.find(h => h.name === name);
  return match ? match.range : '';
}

export function normalizeTraditionalHour(value: string): string {
  return value ? getTraditionalHour(value) : '';
}
