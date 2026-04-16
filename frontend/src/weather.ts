export type WeatherDisplayCondition =
  | 'Sunny'
  | 'PartlyCloudy'
  | 'Overcast'
  | 'Foggy'
  | 'Drizzle'
  | 'Rainy'
  | 'Stormy'
  | 'Windy';

export type WeatherShaderCondition = 'Sunny' | 'Cloudy' | 'Rainy';
export type WeatherDecalCondition = 'Sun' | 'Cloudy' | 'Rainy';

export interface WeatherSnapshot {
  condition?: string | null;
  precipitation_pct?: number | null;
  cloudcover?: number | null;
  humidity?: number | null;
  wind_kmh?: number | null;
}

const includesAny = (value: string, needles: string[]) => needles.some((needle) => value.includes(needle));

export const getWeatherDisplayLabel = (condition: WeatherDisplayCondition) => {
  switch (condition) {
    case 'PartlyCloudy':
      return '多云';
    case 'Overcast':
      return '阴天';
    case 'Foggy':
      return '有雾';
    case 'Drizzle':
      return '小雨';
    case 'Rainy':
      return '中到大雨';
    case 'Stormy':
      return '雷阵雨';
    case 'Windy':
      return '大风';
    default:
      return '晴朗';
  }
};

export function deriveWeatherVisual(weather?: WeatherSnapshot | null): {
  displayCondition: WeatherDisplayCondition;
  shaderCondition: WeatherShaderCondition;
  decalCondition: WeatherDecalCondition;
  label: string;
} {
  const raw = String(weather?.condition ?? '').trim().toLowerCase();
  const precip = Number(weather?.precipitation_pct ?? 0);
  const cloud = Number(weather?.cloudcover ?? 0);
  const humidity = Number(weather?.humidity ?? 0);
  const wind = Number(weather?.wind_kmh ?? 0);

  const hasFogWords = includesAny(raw, ['fog', 'mist', 'haze']);
  const hasStormWords = includesAny(raw, ['storm', 'thunder', 'squall']);
  const hasDrizzleWords = includesAny(raw, ['drizzle', 'shower']);
  const hasRainWords = includesAny(raw, ['rain']);
  const hasOvercastWords = includesAny(raw, ['overcast']);
  const hasCloudWords = includesAny(raw, ['cloud']);
  const hasPartlyWords = includesAny(raw, ['partly']);
  const hasSunWords = includesAny(raw, ['clear', 'sun', 'fair']);

  let displayCondition: WeatherDisplayCondition;

  if (hasStormWords || (precip >= 85 && wind >= 28)) {
    displayCondition = 'Stormy';
  } else if (hasFogWords || (humidity >= 93 && cloud >= 72 && precip < 35)) {
    displayCondition = 'Foggy';
  } else if (hasDrizzleWords || ((hasRainWords || raw === 'rainy') && precip > 0 && precip < 45)) {
    displayCondition = 'Drizzle';
  } else if (hasRainWords || raw === 'rainy' || precip >= 45) {
    displayCondition = 'Rainy';
  } else if (wind >= 38 && precip < 20) {
    displayCondition = 'Windy';
  } else if (hasOvercastWords || cloud >= 85) {
    displayCondition = 'Overcast';
  } else if (hasPartlyWords || ((hasCloudWords || raw === 'cloudy') && cloud < 85) || cloud >= 28) {
    displayCondition = 'PartlyCloudy';
  } else if (hasSunWords || raw === 'sunny' || raw === 'clear') {
    displayCondition = 'Sunny';
  } else {
    displayCondition = cloud >= 60 ? 'Overcast' : cloud >= 28 ? 'PartlyCloudy' : 'Sunny';
  }

  let shaderCondition: WeatherShaderCondition;
  let decalCondition: WeatherDecalCondition;
  switch (displayCondition) {
    case 'Drizzle':
    case 'Rainy':
    case 'Stormy':
      shaderCondition = 'Rainy';
      decalCondition = 'Rainy';
      break;
    case 'Sunny':
      shaderCondition = 'Sunny';
      decalCondition = 'Sun';
      break;
    default:
      shaderCondition = 'Cloudy';
      decalCondition = 'Cloudy';
      break;
  }

  return {
    displayCondition,
    shaderCondition,
    decalCondition,
    label: getWeatherDisplayLabel(displayCondition),
  };
}
