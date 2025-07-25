// SignalK App and Plugin interfaces
export interface SignalKApp {
  debug: (msg: string) => void;
  error: (msg: string) => void;
  handleMessage: (pluginId: string, delta: SignalKDelta) => void;
  savePluginOptions: (options: any, callback: (err?: any) => void) => void;
  setProviderStatus: (msg: string) => void;
  getDataDirPath: () => string;
  subscriptionmanager: {
    subscribe: (
      subscription: SubscriptionRequest,
      unsubscribes: Array<() => void>,
      subscriptionError: (err: unknown) => void,
      dataCallback: (delta: SignalKDelta) => void
    ) => void;
  };
  registerPutHandler: (
    context: string,
    path: string,
    handler: (
      context: string,
      path: string,
      value: any,
      callback?: (result: { state: string; statusCode?: number }) => void
    ) => { state: string; statusCode?: number },
    source?: string
  ) => void;
}

export interface SignalKPlugin {
  id: string;
  name: string;
  description: string;
  schema: any;
  start: (options: Partial<PluginConfig>, restartPlugin?: () => void) => void;
  stop: () => void;
  config?: PluginConfig;
}

// Plugin configuration
export interface PluginConfig {
  stationId: number;
  vesselName?: string;
  apiToken: string;
  udpPort: number;
  enableWebSocket: boolean;
  enableForecast: boolean;
  forecastInterval: number;
  enableWindCalculations: boolean;
  deviceId: number;
  enablePutControl: boolean;
  webSocketControlPath: string;
  forecastControlPath: string;
  windCalculationsControlPath: string;
}

// PUT handler type
export type PutHandler = (
  context: string,
  path: string,
  value: any,
  callback?: (result: { state: string; statusCode?: number }) => void
) => { state: string; statusCode?: number };

// Plugin state
export interface PluginState {
  udpServer: any;
  wsConnection: any;
  forecastInterval: NodeJS.Timeout | null;
  windyInterval: NodeJS.Timeout | null;
  windCalculations: any;
  navigationSubscriptions: Array<() => void>;
  currentConfig?: PluginConfig;
  webSocketEnabled: boolean;
  forecastEnabled: boolean;
  windCalculationsEnabled: boolean;
  putHandlers: Map<string, PutHandler>;
}

// WeatherFlow message types
export interface WeatherFlowMessage {
  type: string;
  serial_number?: string;
  hub_sn?: string;
  ob?: number[];
  obs?: number[][];
  evt?: number[];
  device_id?: number;
  source?: string;
}

export interface RapidWindData {
  type: 'rapid_wind';
  serial_number: string;
  hub_sn: string;
  ob: [number, number, number]; // [timeEpoch, windSpeed, windDirection]
  device_id: number;
  source: string;
}

export interface TempestObservationData {
  type: 'obs_st';
  serial_number: string;
  hub_sn: string;
  obs: number[][]; // Array of observation arrays
  firmware_revision: number;
  device_id: number;
  source: string;
}

export interface AirObservationData {
  type: 'obs_air';
  serial_number: string;
  hub_sn: string;
  obs: number[][]; // Array of observation arrays
  firmware_revision: number;
  device_id: number;
  source: string;
}

export interface RainEventData {
  type: 'evt_precip';
  serial_number: string;
  hub_sn: string;
  evt: [number]; // [timeEpoch]
  device_id: number;
  source: string;
}

export interface LightningEventData {
  type: 'evt_strike';
  serial_number: string;
  hub_sn: string;
  evt: [number, number, number]; // [timeEpoch, distance, energy]
  device_id: number;
  source: string;
}

// Processed observation data
export interface ProcessedWindData {
  timeEpoch: number;
  windSpeed: number;
  windDirection: number;
  utcDate: string;
}

export interface ProcessedTempestData {
  timeEpoch: number;
  windLull: number;
  windAvg: number;
  windGust: number;
  windDirection: number;
  windSampleInterval: number;
  stationPressure: number;
  airTemperature: number;
  relativeHumidity: number;
  illuminance: number;
  uvIndex: number;
  solarRadiation: number;
  rainAccumulated: number;
  precipitationType: number;
  lightningStrikeAvgDistance: number;
  lightningStrikeCount: number;
  battery: number;
  reportInterval: number;
  localDailyRainAccumulation: number;
  rainAccumulatedFinal: number;
  localDailyRainAccumulationFinal: number;
  precipitationAnalysisType: number;
  utcDate: string;
}

export interface ProcessedAirData {
  timeEpoch: number;
  stationPressure: number;
  airTemperature: number;
  relativeHumidity: number;
  lightningStrikeCount: number;
  lightningStrikeAvgDistance: number;
  battery: number;
  reportInterval: number;
  utcDate: string;
}

export interface ProcessedRainData {
  timeEpoch: number;
  utcDate: string;
}

export interface ProcessedLightningData {
  timeEpoch: number;
  lightningStrikeAvgDistance: number;
  energy: number;
  utcDate: string;
}

// WebSocket message types
export interface WebSocketMessage {
  type?: string;
  device_id?: number;
  id?: string;
  summary?: any;
  status?: any;
  obs?: number[][];
  utcDate?: string;
}

// Forecast data types
export interface ForecastData {
  current_conditions?: CurrentConditions;
  forecast?: {
    hourly?: HourlyForecast[];
    daily?: DailyForecast[];
  };
}

export interface CurrentConditions {
  time?: number;
  conditions?: string;
  icon?: string;
  air_temperature?: number;
  feels_like?: number;
  relative_humidity?: number;
  wind_avg?: number;
  wind_direction?: number;
  wind_gust?: number;
  uv?: number;
  brightness?: number;
  solar_radiation?: number;
  lightning_strike_count_last_1hr?: number;
  lightning_strike_count_last_3hr?: number;
  lightning_strike_last_distance?: number;
  lightning_strike_last_epoch?: number;
  precip_accum_local_yesterday?: number;
  precip_accum_local_yesterday_final?: number;
  precip_analysis_type_yesterday?: number;
  pressure_trend?: string;
  station_pressure?: number;
  sea_level_pressure?: number;
}

export interface HourlyForecast {
  time?: number;
  conditions?: string;
  icon?: string;
  air_temperature?: number;
  feels_like?: number;
  relative_humidity?: number;
  wind_avg?: number;
  wind_direction?: number;
  wind_gust?: number;
  precip?: number;
  precip_probability?: number;
  precip_type?: string;
  uv?: number;
  sea_level_pressure?: number;
  station_pressure?: number;
  datetime?: string;
}

export interface DailyForecast {
  day_start_local?: number;
  day_num?: number;
  month_num?: number;
  conditions?: string;
  icon?: string;
  sunrise?: number;
  sunset?: number;
  air_temp_high?: number;
  air_temp_low?: number;
  precip_probability?: number;
  precip_icon?: string;
  precip_type?: string;
  wind_avg?: number;
  wind_direction?: number;
  day_start_local_iso?: string;
  sunrise_iso?: string;
  sunset_iso?: string;
}

// Wind calculation types
export interface WindInput {
  windSpeed: number;
  windDirection: number;
  airTemperature?: number;
}

export interface ApparentWindData {
  windSpeed: number;
  windAngleRelative: number;
  windAngleRelativeRad: number;
  apparentTrueDeg: number;
  apparentMagneticDeg: number;
  apparentTrueRad: number;
  apparentMagneticRad: number;
  airTemperature: number;
}

export interface DerivedWindValues {
  speedApparent: number;
  angleApparent: number;
  angleTrueGround: number;
  angleTrueWater: number;
  directionTrue: number;
  directionMagnetic: number;
  speedTrue: number;
  windChill: number | null;
  heatIndex: number | null;
  feelsLike: number;
  timestamp: string;
  source: string;
}

// Unit conversion result
export interface ConvertedValue {
  value: any;
  units: string | null;
}

// SignalK Delta types
export interface SignalKDelta {
  context: string;
  updates: SignalKUpdate[];
}

export interface SignalKUpdate {
  $source?: string;
  source?: {
    label: string;
    type?: string;
  };
  timestamp: string;
  values: SignalKValue[];
  meta?: SignalKMeta[];
}

export interface SignalKValue {
  path: string;
  value: any;
}

export interface SignalKMeta {
  path: string;
  value: {
    units?: string;
    description?: string;
  };
}

// Subscription types
export interface SubscriptionRequest {
  context: string;
  subscribe: SubscriptionItem[];
}

export interface SubscriptionItem {
  path: string;
  policy: 'fixed' | 'ideal' | 'instant';
  period?: number;
  format: 'delta' | 'full';
}

export interface SubscriptionValue {
  path: string;
  value: any;
  timestamp: string;
  $source?: string;
}
