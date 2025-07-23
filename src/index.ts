import * as dgram from 'dgram';
import * as WebSocket from 'ws';
const fetch = require('node-fetch');
import { WindCalculations } from './windCalculations';
import {
  SignalKApp,
  SignalKPlugin,
  PluginConfig,
  PluginState,
  WeatherFlowMessage,
  RapidWindData,
  TempestObservationData,
  AirObservationData,
  RainEventData,
  LightningEventData,
  WebSocketMessage,
  ForecastData,
  ProcessedWindData,
  ProcessedTempestData,
  ProcessedAirData,
  ProcessedRainData,
  ProcessedLightningData,
  ConvertedValue,
  SignalKDelta,
  SignalKUpdate,
  SubscriptionRequest,
  SubscriptionValue,
  WindInput,
  PutHandler,
} from './types';

export = function (app: SignalKApp): SignalKPlugin {
  const plugin: SignalKPlugin = {
    id: 'signalk-weatherflow',
    name: 'SignalK WeatherFlow Ingester',
    description:
      'Ingests data from WeatherFlow weather stations via UDP, WebSocket, and API',
    schema: {},
    start: () => {},
    stop: () => {},
  };

  const state: PluginState = {
    udpServer: null,
    wsConnection: null,
    forecastInterval: null,
    windyInterval: null,
    windCalculations: null,
    navigationSubscriptions: [],
    currentConfig: undefined,
    webSocketEnabled: true,
    forecastEnabled: true,
    windCalculationsEnabled: true,
    putHandlers: new Map(),
  };

  // Configuration schema
  plugin.schema = {
    type: 'object',
    required: ['stationId', 'apiToken'],
    properties: {
      stationId: {
        type: 'number',
        title: 'WeatherFlow Station ID',
        description: 'Your WeatherFlow station ID',
        default: 118081,
      },
      vesselName: {
        type: 'string',
        title: 'Vessel Name',
        description:
          'Vessel name for source identification (defaults to "weatherflow" if not specified)',
        default: '',
      },
      apiToken: {
        type: 'string',
        title: 'WeatherFlow API Token',
        description: 'Your WeatherFlow API token',
        default: '',
      },
      udpPort: {
        type: 'number',
        title: 'UDP Listen Port',
        description: 'Port to listen for WeatherFlow UDP broadcasts',
        default: 50222,
      },
      enableWebSocket: {
        type: 'boolean',
        title: 'Enable WebSocket Connection',
        description: 'Connect to WeatherFlow WebSocket for real-time data',
        default: true,
      },
      enableForecast: {
        type: 'boolean',
        title: 'Enable Forecast Data',
        description: 'Fetch forecast data from WeatherFlow API',
        default: true,
      },
      forecastInterval: {
        type: 'number',
        title: 'Forecast Update Interval (minutes)',
        description: 'How often to fetch forecast data',
        default: 30,
      },
      enableWindCalculations: {
        type: 'boolean',
        title: 'Enable Wind Calculations',
        description: 'Calculate true wind from apparent wind',
        default: true,
      },
      deviceId: {
        type: 'number',
        title: 'WeatherFlow Device ID',
        description: 'Your WeatherFlow device ID for WebSocket connection',
        default: 405588,
      },
      enablePutControl: {
        type: 'boolean',
        title: 'Enable PUT Control',
        description: 'Allow external control of individual plugin services via PUT requests',
        default: false,
      },
      webSocketControlPath: {
        type: 'string',
        title: 'WebSocket Control Path',
        description: 'SignalK path for WebSocket control',
        default: 'network.weatherflow.webSocket.state',
      },
      forecastControlPath: {
        type: 'string',
        title: 'Forecast Control Path',
        description: 'SignalK path for forecast control',
        default: 'network.weatherflow.forecast.state',
      },
      windCalculationsControlPath: {
        type: 'string',
        title: 'Wind Calculations Control Path',
        description: 'SignalK path for wind calculations control',
        default: 'network.weatherflow.windCalculations.state',
      },
    },
  };

  // Utility function to format name according to source naming rules
  function formatSourceName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Utility function to get formatted vessel name for source
  function getVesselBasedSource(
    configuredPrefix: string | undefined,
    suffix: string
  ): string {
    // Use configured prefix if provided, otherwise default to "signalk" for now
    const vesselPrefix =
      configuredPrefix && configuredPrefix.trim()
        ? configuredPrefix
        : 'signalk';
    const formattedName = formatSourceName(vesselPrefix);
    return `${formattedName}-weatherflow-${suffix}`;
  }

  // Utility function to convert underscore_case to camelCase
  function toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  // Persistent state management
  function getStateFilePath(): string {
    return require('path').join(app.getDataDirPath(), 'signalk-weatherflow-state.json');
  }

  function loadPersistedState(): Partial<{ webSocketEnabled: boolean; forecastEnabled: boolean; windCalculationsEnabled: boolean }> {
    try {
      const fs = require('fs');
      const stateFile = getStateFilePath();
      if (fs.existsSync(stateFile)) {
        const data = fs.readFileSync(stateFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      app.debug('Could not load persisted state: ' + (error as Error).message);
    }
    return {};
  }

  function savePersistedState(): void {
    try {
      const fs = require('fs');
      const stateToSave = {
        webSocketEnabled: state.webSocketEnabled,
        forecastEnabled: state.forecastEnabled,
        windCalculationsEnabled: state.windCalculationsEnabled,
      };
      fs.writeFileSync(getStateFilePath(), JSON.stringify(stateToSave, null, 2));
    } catch (error) {
      app.error('Could not save persisted state: ' + (error as Error).message);
    }
  }

  // Setup PUT control for individual service control
  function setupPutControl(config: PluginConfig): void {
    const controlPaths = [
      { path: config.webSocketControlPath, service: 'webSocket' },
      { path: config.forecastControlPath, service: 'forecast' },
      { path: config.windCalculationsControlPath, service: 'windCalculations' }
    ];

    controlPaths.forEach(({ path, service }) => {
      // Create PUT handler
      const putHandler: PutHandler = (
        context: string,
        requestPath: string,
        value: any,
        callback?: (result: { state: string; statusCode?: number }) => void
      ): { state: string; statusCode?: number } => {
        app.debug(`PUT request received for ${requestPath} with value: ${JSON.stringify(value)}`);
        
        if (requestPath === path) {
          const newState = Boolean(value);
          handleServiceControl(service, newState, config);
          
          // Save the new state to persist across restarts
          savePersistedState();
          
          // Publish updated state
          const updatedDelta = createSignalKDelta(
            path,
            newState,
            getVesselBasedSource(config.vesselName, 'control')
          );
          app.handleMessage(plugin.id, updatedDelta);
          
          const result = { state: 'COMPLETED' };
          if (callback) callback(result);
          return result;
        } else {
          const result = { state: 'COMPLETED', statusCode: 405 };
          if (callback) callback(result);
          return result;
        }
      };

      // Register PUT handler with SignalK
      app.registerPutHandler(
        'vessels.self',
        path,
        putHandler,
        'signalk-weatherflow'
      );

      // Store handler for cleanup
      state.putHandlers.set(path, putHandler);
      
      // Publish current state (which reflects config checkboxes)
      const currentState = getServiceState(service);
      const initialDelta = createSignalKDelta(
        path,
        currentState,
        getVesselBasedSource(config.vesselName, 'control')
      );
      app.handleMessage(plugin.id, initialDelta);
      
      app.debug(`PUT control enabled for ${service} on path: ${path}`);
    });
  }

  // Handle individual service control
  function handleServiceControl(service: string, newState: boolean, config: PluginConfig): void {
    const currentState = getServiceState(service);
    
    if (newState !== currentState) {
      app.debug(`${newState ? 'Enabling' : 'Disabling'} ${service} via PUT control`);
      
      if (service === 'webSocket') {
        state.webSocketEnabled = newState;
        if (newState && config.enableWebSocket && config.apiToken) {
          startWebSocketConnection(config.apiToken, config.deviceId, config.vesselName);
        } else if (!newState && state.wsConnection) {
          state.wsConnection.close();
          state.wsConnection = null;
        }
      } else if (service === 'forecast') {
        state.forecastEnabled = newState;
        if (newState && config.enableForecast && config.apiToken && config.stationId) {
          startForecastFetching(config);
        } else if (!newState && state.forecastInterval) {
          clearInterval(state.forecastInterval);
          state.forecastInterval = null;
        }
      } else if (service === 'windCalculations') {
        state.windCalculationsEnabled = newState;
        if (newState && config.enableWindCalculations) {
          state.windCalculations = new WindCalculations(app, config.vesselName);
          setupNavigationSubscriptions();
        } else if (!newState) {
          state.navigationSubscriptions.forEach(unsub => unsub());
          state.navigationSubscriptions = [];
          state.windCalculations = null;
        }
      }
      
      app.setProviderStatus(`WeatherFlow ${service} ${newState ? 'enabled' : 'disabled'} via external control`);
    }
  }

  // Get current state of a service
  function getServiceState(service: string): boolean {
    switch (service) {
      case 'webSocket': return state.webSocketEnabled;
      case 'forecast': return state.forecastEnabled;
      case 'windCalculations': return state.windCalculationsEnabled;
      default: return false;
    }
  }


  // Start plugin services (factored out for PUT control)
  function startPluginServices(config: PluginConfig): void {
    // Initialize wind calculations if enabled and not controlled externally
    if (config.enableWindCalculations && state.windCalculationsEnabled) {
      state.windCalculations = new WindCalculations(app, config.vesselName);
      setupNavigationSubscriptions();
    }

    // Initialize UDP listener (always enabled - not controlled separately)
    startUdpServer(config.udpPort, config);

    // Initialize WebSocket connection if enabled and not controlled externally
    if (config.enableWebSocket && config.apiToken && state.webSocketEnabled) {
      startWebSocketConnection(
        config.apiToken,
        config.deviceId,
        config.vesselName
      );
    }

    // Initialize forecast data fetching if enabled and not controlled externally
    if (config.enableForecast && config.apiToken && config.stationId && state.forecastEnabled) {
      startForecastFetching(config);
    }
  }

  // Stop plugin services (factored out for PUT control)
  function stopPluginServices(): void {
    // Stop UDP server
    if (state.udpServer) {
      state.udpServer.close();
      state.udpServer = null;
    }

    // Close WebSocket connection
    if (state.wsConnection) {
      state.wsConnection.close();
      state.wsConnection = null;
    }

    // Clear forecast interval
    if (state.forecastInterval) {
      clearInterval(state.forecastInterval);
      state.forecastInterval = null;
    }

    // Unsubscribe from navigation data
    state.navigationSubscriptions.forEach(unsub => unsub());
    state.navigationSubscriptions = [];

    // Clear wind calculations
    state.windCalculations = null;
  }

  // Plugin start function
  plugin.start = function (
    options: Partial<PluginConfig>,
    restartPlugin?: () => void
  ): void {
    app.debug(
      'Starting WeatherFlow plugin with options: ' + JSON.stringify(options)
    );
    app.setProviderStatus('Initializing WeatherFlow plugin...');

    const config: PluginConfig = {
      stationId: options.stationId || 118081,
      vesselName: options.vesselName,
      apiToken: options.apiToken || '',
      udpPort: options.udpPort || 50222,
      enableWebSocket: options.enableWebSocket !== false,
      enableForecast: options.enableForecast !== false,
      forecastInterval: options.forecastInterval || 30,
      enableWindCalculations: options.enableWindCalculations !== false,
      deviceId: options.deviceId || 405588,
      enablePutControl: options.enablePutControl === true,
      webSocketControlPath: options.webSocketControlPath || 'network.weatherflow.webSocket.state',
      forecastControlPath: options.forecastControlPath || 'network.weatherflow.forecast.state',
      windCalculationsControlPath: options.windCalculationsControlPath || 'network.weatherflow.windCalculations.state',
    };

    state.currentConfig = config;
    plugin.config = config;

    // Load persisted state, fall back to config defaults
    const persistedState = loadPersistedState();
    state.webSocketEnabled = persistedState.webSocketEnabled ?? config.enableWebSocket;
    state.forecastEnabled = persistedState.forecastEnabled ?? config.enableForecast;
    state.windCalculationsEnabled = persistedState.windCalculationsEnabled ?? config.enableWindCalculations;

    // Start plugin services
    startPluginServices(config);

    // Initialize PUT control if enabled
    if (config.enablePutControl) {
      setupPutControl(config);
    }

    app.debug('WeatherFlow plugin started successfully');
    app.setProviderStatus('WeatherFlow plugin running');
  };

  // Plugin stop function
  plugin.stop = function (): void {
    app.debug('Stopping WeatherFlow plugin');

    // Stop plugin services
    stopPluginServices();

    // Clean up PUT handlers
    state.putHandlers.clear();

    if (state.windyInterval) {
      clearInterval(state.windyInterval);
      state.windyInterval = null;
    }

    app.debug('WeatherFlow plugin stopped');
    app.setProviderStatus('WeatherFlow plugin stopped');
  };

  // Setup navigation data subscriptions for wind calculations
  function setupNavigationSubscriptions(): void {
    if (!state.windCalculations) return;

    const subscriptionPaths = [
      'navigation.headingTrue',
      'navigation.headingMagnetic',
      'navigation.courseOverGroundMagnetic',
      'navigation.speedOverGround',
      'environment.outside.tempest.observations.airTemperature',
      'environment.outside.tempest.observations.relativeHumidity',
    ];

    const subscription: SubscriptionRequest = {
      context: 'vessels.self',
      subscribe: subscriptionPaths.map(path => ({
        path,
        policy: 'fixed' as const,
        period: 1000,
        format: 'delta' as const,
      })),
    };

    app.subscriptionmanager.subscribe(
      subscription,
      state.navigationSubscriptions,
      (subscriptionError: unknown) => {
        app.debug('Navigation subscription error: ' + subscriptionError);
      },
      (delta: any) => {
        handleNavigationData(delta);
      }
    );
  }

  // Handle navigation data from subscriptions
  function handleNavigationData(delta: any): void {
    if (!delta.updates || !state.windCalculations) return;

    delta.updates.forEach((update: any) => {
      if (!(update as any).values) return;

      (update as any).values.forEach((valueUpdate: any) => {
        if (valueUpdate.path && typeof valueUpdate.value === 'number') {
          state.windCalculations.updateNavigationData(
            valueUpdate.path,
            valueUpdate.value
          );
        }
      });
    });
  }

  // Start UDP server for WeatherFlow broadcasts
  function startUdpServer(port: number, config: PluginConfig): void {
    state.udpServer = dgram.createSocket('udp4');

    state.udpServer.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      try {
        const data: WeatherFlowMessage = JSON.parse(msg.toString());
        processWeatherFlowMessage(data, config);
      } catch (error) {
        app.debug('Error parsing UDP message: ' + (error as Error).message);
      }
    });

    state.udpServer.on('error', (err: Error) => {
      app.error('UDP server error: ' + err.message);
    });

    state.udpServer.bind(port, () => {
      app.debug('WeatherFlow UDP server listening on port ' + port);
    });
  }

  // Start WebSocket connection to WeatherFlow
  function startWebSocketConnection(
    token: string,
    deviceId: number,
    vesselName?: string
  ): void {
    const wsUrl = `wss://ws.weatherflow.com/swd/data?token=${token}`;

    state.wsConnection = new WebSocket.WebSocket(wsUrl);

    state.wsConnection.on('open', () => {
      app.debug('WeatherFlow WebSocket connected');

      // Request data for device
      const request = {
        type: 'listen_start',
        device_id: deviceId || 405588,
        id: Date.now().toString(),
      };
      state.wsConnection!.send(JSON.stringify(request));
    });

    state.wsConnection.on('message', (data: WebSocket.Data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        processWebSocketMessage(message, vesselName);
      } catch (error) {
        app.debug(
          'Error parsing WebSocket message: ' + (error as Error).message
        );
      }
    });

    state.wsConnection.on('error', (error: Error) => {
      app.error('WebSocket error: ' + error.message);
    });

    state.wsConnection.on('close', () => {
      app.debug('WebSocket connection closed');
      // Implement reconnection logic here if needed
    });
  }

  // Start forecast data fetching
  function startForecastFetching(config: PluginConfig): void {
    const fetchForecast = async (): Promise<void> => {
      try {
        const url = `https://swd.weatherflow.com/swd/rest/better_forecast?station_id=${config.stationId}&token=${config.apiToken}`;
        const response = await fetch(url);
        const data: ForecastData = await response.json();
        processForecastData(data, config.vesselName);
      } catch (error) {
        app.error('Error fetching forecast data: ' + (error as Error).message);
      }
    };

    // Fetch immediately
    fetchForecast();

    // Set up interval
    const intervalMs = (config.forecastInterval || 30) * 60 * 1000;
    state.forecastInterval = setInterval(fetchForecast, intervalMs);
  }

  // Process WeatherFlow UDP messages
  function processWeatherFlowMessage(
    data: WeatherFlowMessage,
    config: PluginConfig
  ): void {
    if (!data.type) return;

    switch (data.type) {
      case 'rapid_wind':
        processRapidWind(data as RapidWindData, config);
        break;
      case 'obs_st':
        processTempestObservation(data as TempestObservationData, config);
        break;
      case 'obs_air':
        processAirObservation(data as AirObservationData, config);
        break;
      case 'evt_precip':
        processRainEvent(data as RainEventData, config);
        break;
      case 'evt_strike':
        processLightningEvent(data as LightningEventData, config);
        break;
      default:
        app.debug('Unknown WeatherFlow message type: ' + data.type);
    }
  }

  // Helper function to convert snake_case to camelCase
  function snakeToCamel(str: string): string {
    return str.replace(/_([a-z0-9])/g, (match, letter) => letter.toUpperCase());
  }

  // Helper function to send individual SignalK deltas with units metadata
  function sendSignalKDelta(
    basePath: string,
    key: string,
    value: any,
    source: string,
    timestamp: string
  ): void {
    const converted = convertToSignalKUnits(key, value);
    const camelKey = snakeToCamel(key);

    const path = `${basePath}.${camelKey}`;

    const delta: SignalKDelta = {
      context: 'vessels.self',
      updates: [
        {
          $source: source,
          timestamp: timestamp,
          values: [
            {
              path: path,
              value: converted.value,
            },
          ],
        },
      ],
    };

    // Add units metadata if available
    if (converted.units) {
      delta.updates[0].meta = [
        {
          path: path,
          value: {
            units: converted.units,
          },
        },
      ];
    }

    app.handleMessage(plugin.id, delta);
  }

  // Convert WeatherFlow values to SignalK standard units and get units metadata
  function convertToSignalKUnits(key: string, value: any): ConvertedValue {
    if (value === null || value === undefined) return { value, units: null };

    // Normalize key to camelCase for consistent matching
    const normalizedKey = snakeToCamel(key);

    switch (normalizedKey) {
      // Temperature conversions: °C to K
      case 'airTemperature':
      case 'feelsLike':
      case 'heatIndex':
      case 'windChill':
      case 'dewPoint':
      case 'wetBulbTemperature':
      case 'wetBulbGlobeTemperature':
        return { value: value + 273.15, units: 'K' };

      // Pressure conversions: MB to Pa
      case 'stationPressure':
      case 'pressure':
        return { value: value * 100, units: 'Pa' };

      // Direction conversions: degrees to radians
      case 'windDirection':
        return { value: value * (Math.PI / 180), units: 'rad' };

      // Distance conversions: km to m
      case 'lightningStrikeAvgDistance':
      case 'strikeLastDist':
        return { value: value * 1000, units: 'm' };

      // Time conversions: minutes to seconds
      case 'reportInterval':
        return { value: value * 60, units: 's' };

      // Rain conversions: mm to m
      case 'rainAccumulated':
      case 'rainAccumulatedFinal':
      case 'localDailyRainAccumulation':
      case 'localDailyRainAccumulationFinal':
      case 'precipTotal1h':
      case 'precipAccumLocalYesterday':
      case 'precipAccumLocalYesterdayFinal':
        return { value: value / 1000, units: 'm' };

      // Relative humidity: % to ratio (0-1)
      case 'relativeHumidity':
        return { value: value / 100, units: 'ratio' };

      // Wind speeds (already in m/s)
      case 'windLull':
      case 'windAvg':
      case 'windGust':
      case 'windSpeed':
        return { value: value, units: 'm/s' };

      // Time values (already in seconds)
      case 'windSampleInterval':
      case 'timeEpoch':
      case 'strikeLastEpoch':
      case 'precipMinutesLocalDay':
      case 'precipMinutesLocalYesterday':
        return { value: value, units: 's' };

      // Illuminance (lux)
      case 'illuminance':
        return { value: value, units: 'lux' };

      // Solar radiation (W/m²)
      case 'solarRadiation':
        return { value: value, units: 'W/m2' };

      // Battery voltage
      case 'battery':
        return { value: value, units: 'V' };

      // Air density (kg/m³)
      case 'airDensity':
        return { value: value, units: 'kg/m3' };

      // Temperature difference (already in K)
      case 'deltaT':
        return { value: value, units: 'K' };

      // Counts and indices (dimensionless)
      case 'uvIndex':
      case 'precipitationType':
      case 'precipType':
      case 'lightningStrikeCount':
      case 'strikeCount1h':
      case 'strikeCount3h':
      case 'precipitationAnalysisType':
      case 'deviceId':
      case 'firmwareRevision':
      case 'precipAnalysisTypeYesterday':
      case 'type':
      case 'source':
      case 'statusCode':
      case 'statusMessage':
      case 'id':
        return { value: value, units: null };

      // String values (no units)
      case 'serialNumber':
      case 'hubSn':
      case 'pressureTrend':
        return { value: value, units: null };

      default:
        return { value: value, units: null };
    }
  }

  // Process WebSocket messages
  function processWebSocketMessage(
    data: WebSocketMessage,
    vesselName?: string
  ): void {
    // Check if WebSocket processing is enabled
    if (!state.webSocketEnabled) {
      return;
    }
    // Flatten summary and status properties
    if (data.summary && typeof data.summary === 'object') {
      Object.assign(data, data.summary);
      delete data.summary;
    }

    if (data.status && typeof data.status === 'object') {
      Object.assign(data, data.status);
      delete data.status;
    }

    // Process observation array if present
    if (data.obs && Array.isArray(data.obs) && data.obs.length > 0) {
      const obsArray = data.obs[0];
      const parsedObs = {
        timeEpoch: obsArray[0],
        windLull: obsArray[1],
        windAvg: obsArray[2],
        windGust: obsArray[3],
        windDirection: obsArray[4], // Will be converted to radians by convertToSignalKUnits
        windSampleInterval: obsArray[5],
        stationPressure: obsArray[6], // Will be converted to Pa by convertToSignalKUnits
        airTemperature: obsArray[7], // Will be converted to K by convertToSignalKUnits
        relativeHumidity: obsArray[8], // Will be converted to ratio by convertToSignalKUnits
        illuminance: obsArray[9],
        uvIndex: obsArray[10],
        solarRadiation: obsArray[11],
        rainAccumulated: obsArray[12], // Will be converted to m by convertToSignalKUnits
        precipitationType: obsArray[13],
        lightningStrikeAvgDistance: obsArray[14], // Will be converted to m by convertToSignalKUnits
        lightningStrikeCount: obsArray[15],
        battery: obsArray[16],
        reportInterval: obsArray[17], // Will be converted to sec by convertToSignalKUnits
        localDailyRainAccumulation: obsArray[18], // Will be converted to m by convertToSignalKUnits
        rainAccumulatedFinal: obsArray[19], // Will be converted to m by convertToSignalKUnits
        localDailyRainAccumulationFinal: obsArray[20], // Will be converted to m by convertToSignalKUnits
        precipitationAnalysisType: obsArray[21],
      };

      Object.assign(data, parsedObs);
      delete data.obs;
    }

    // Send individual deltas for each observation value
    const timestamp = data.utcDate || new Date().toISOString();
    const source = getVesselBasedSource(vesselName, 'ws');

    // Create individual deltas for each observation property
    Object.entries(data).forEach(([key, value]) => {
      if (key === 'utcDate') return; // Skip timestamp, use it for deltas
      sendSignalKDelta(
        'environment.outside.tempest.observations',
        key,
        value,
        source,
        timestamp
      );
    });
  }

  // Process rapid wind observations
  function processRapidWind(data: RapidWindData, config: PluginConfig): void {
    if (!data.ob) return;

    const [timeEpoch, windSpeed, windDirection] = data.ob;
    const windData: ProcessedWindData = {
      timeEpoch,
      windSpeed,
      windDirection, // Will be converted to radians by convertToSignalKUnits
      utcDate: new Date(timeEpoch * 1000).toISOString(),
    };

    // Send individual deltas for each wind observation
    const timestamp = windData.utcDate;
    const source = getVesselBasedSource(config.vesselName, 'udp');

    Object.entries(windData).forEach(([key, value]) => {
      if (key === 'utcDate') return; // Skip timestamp
      sendSignalKDelta(
        'environment.outside.rapidWind',
        key,
        value,
        source,
        timestamp
      );
    });

    // Calculate wind values if enabled
    if (config.enableWindCalculations && state.windCalculations) {
      calculateAndPublishWind({
        windSpeed,
        windDirection,
        airTemperature: state.windCalculations.airTemp,
      });
    }
  }

  // Calculate and publish wind values
  function calculateAndPublishWind(windData: WindInput): void {
    if (!state.windCalculations) return;

    try {
      const apparentWind =
        state.windCalculations.calculateApparentWind(windData);
      const derivedWind =
        state.windCalculations.calculateDerivedWindValues(apparentWind);
      const windDeltas = state.windCalculations.createWindDeltas(derivedWind);

      // Send all wind deltas to SignalK
      windDeltas.forEach((delta: any) => {
        app.handleMessage(plugin.id, delta);
      });
    } catch (error) {
      app.debug('Error calculating wind values: ' + (error as Error).message);
    }
  }

  // Process Tempest station observations
  function processTempestObservation(
    data: TempestObservationData,
    config: PluginConfig
  ): void {
    if (!data.obs || !data.obs[0]) return;

    const obs = data.obs[0];
    const observationData: ProcessedTempestData = {
      timeEpoch: obs[0],
      windLull: obs[1],
      windAvg: obs[2],
      windGust: obs[3],
      windDirection: obs[4], // Will be converted to radians by convertToSignalKUnits
      windSampleInterval: obs[5],
      stationPressure: obs[6], // Will be converted to Pa by convertToSignalKUnits
      airTemperature: obs[7], // Will be converted to K by convertToSignalKUnits
      relativeHumidity: obs[8], // Will be converted to ratio by convertToSignalKUnits
      illuminance: obs[9],
      uvIndex: obs[10],
      solarRadiation: obs[11],
      rainAccumulated: obs[12], // Will be converted to m by convertToSignalKUnits
      precipitationType: obs[13],
      lightningStrikeAvgDistance: obs[14], // Will be converted to m by convertToSignalKUnits
      lightningStrikeCount: obs[15],
      battery: obs[16],
      reportInterval: obs[17], // Will be converted to sec by convertToSignalKUnits
      localDailyRainAccumulation: obs[18], // Will be converted to m by convertToSignalKUnits
      rainAccumulatedFinal: obs[19], // Will be converted to m by convertToSignalKUnits
      localDailyRainAccumulationFinal: obs[20], // Will be converted to m by convertToSignalKUnits
      precipitationAnalysisType: obs[21],
      utcDate: new Date(obs[0] * 1000).toISOString(),
    };

    // Send individual deltas for each tempest observation
    const timestamp = observationData.utcDate;
    const source = getVesselBasedSource(config.vesselName, 'udp');

    Object.entries(observationData).forEach(([key, value]) => {
      if (key === 'utcDate') return; // Skip timestamp
      sendSignalKDelta(
        'environment.outside.tempest.observations',
        key,
        value,
        source,
        timestamp
      );
    });

    // Calculate wind values if enabled
    if (config.enableWindCalculations && state.windCalculations) {
      calculateAndPublishWind({
        windSpeed: obs[2], // windAvg
        windDirection: obs[4], // windDirection in degrees
        airTemperature: obs[7], // airTemperature in °C (will be converted in wind calculations)
      });
    }
  }

  // Process Air station observations
  function processAirObservation(
    data: AirObservationData,
    config: PluginConfig
  ): void {
    if (!data.obs || !data.obs[0]) return;

    const obs = data.obs[0];
    const observationData: ProcessedAirData = {
      timeEpoch: obs[0],
      stationPressure: obs[1], // Will be converted to Pa by convertToSignalKUnits
      airTemperature: obs[2], // Will be converted to K by convertToSignalKUnits
      relativeHumidity: obs[3], // Will be converted to ratio by convertToSignalKUnits
      lightningStrikeCount: obs[4],
      lightningStrikeAvgDistance: obs[5], // Will be converted to m by convertToSignalKUnits
      battery: obs[6],
      reportInterval: obs[7], // Will be converted to sec by convertToSignalKUnits
      utcDate: new Date(obs[0] * 1000).toISOString(),
    };

    // Send individual deltas for each air observation
    const timestamp = observationData.utcDate;
    const source = getVesselBasedSource(config.vesselName, 'udp');

    Object.entries(observationData).forEach(([key, value]) => {
      if (key === 'utcDate') return; // Skip timestamp
      sendSignalKDelta(
        'environment.inside.air.observations',
        key,
        value,
        source,
        timestamp
      );
    });
  }

  // Process rain events
  function processRainEvent(data: RainEventData, config: PluginConfig): void {
    if (!data.evt) return;

    const [timeEpoch] = data.evt;
    const rainData: ProcessedRainData = {
      timeEpoch,
      utcDate: new Date(timeEpoch * 1000).toISOString(),
    };

    // Send individual deltas for each rain observation
    const timestamp = rainData.utcDate;
    const source = getVesselBasedSource(config.vesselName, 'udp');

    Object.entries(rainData).forEach(([key, value]) => {
      if (key === 'utcDate') return; // Skip timestamp
      sendSignalKDelta(
        'environment.outside.rain.observations',
        key,
        value,
        source,
        timestamp
      );
    });
  }

  // Process lightning events
  function processLightningEvent(
    data: LightningEventData,
    config: PluginConfig
  ): void {
    if (!data.evt) return;

    const [timeEpoch, distance, energy] = data.evt;
    const lightningData: ProcessedLightningData = {
      timeEpoch,
      lightningStrikeAvgDistance: distance, // Will be converted to m by convertToSignalKUnits
      energy,
      utcDate: new Date(timeEpoch * 1000).toISOString(),
    };

    // Send individual deltas for each lightning observation
    const timestamp = lightningData.utcDate;
    const source = getVesselBasedSource(config.vesselName, 'udp');

    Object.entries(lightningData).forEach(([key, value]) => {
      if (key === 'utcDate') return; // Skip timestamp
      sendSignalKDelta(
        'environment.outside.lightning.observations',
        key,
        value,
        source,
        timestamp
      );
    });
  }

  // Process forecast data
  function processForecastData(data: ForecastData, vesselName?: string): void {
    // Check if forecast processing is enabled
    if (!state.forecastEnabled) {
      return;
    }
    // Process current conditions
    if (data.current_conditions) {
      const delta = createSignalKDelta(
        'environment.outside.tempest.observations',
        data.current_conditions,
        getVesselBasedSource(vesselName, 'api')
      );
      app.handleMessage(plugin.id, delta);
    }

    // Process hourly forecast (first 72 hours)
    if (data.forecast && data.forecast.hourly) {
      data.forecast.hourly.slice(0, 72).forEach((forecast, index) => {
        const source = getVesselBasedSource(vesselName, 'api');
        
        // Create individual deltas for each data point
        Object.entries(forecast).forEach(([key, value]) => {
          if (value !== undefined) {
            let processedValue = value;
            const camelKey = toCamelCase(key);
            
            // Apply unit conversions
            if (key === 'air_temperature' || key === 'feels_like') {
              processedValue = (value as number) + 273.15; // °C to K
            } else if (key === 'sea_level_pressure' || key === 'station_pressure') {
              processedValue = (value as number) * 100; // MB to Pa
            } else if (key === 'wind_direction') {
              processedValue = (value as number) * Math.PI / 180; // degrees to radians
            }
            
            // Add datetime field for time
            if (key === 'time') {
              processedValue = value;
              // Also create datetime version
              const datetimeValue = new Date((value as number) * 1000).toISOString();
              const datetimeDelta = createSignalKDelta(
                `environment.outside.tempest.forecast.hourly.datetime.${index}`,
                datetimeValue,
                source
              );
              app.handleMessage(plugin.id, datetimeDelta);
            }
            
            const delta = createSignalKDelta(
              `environment.outside.tempest.forecast.hourly.${camelKey}.${index}`,
              processedValue,
              source
            );
            app.handleMessage(plugin.id, delta);
          }
        });
      });
    }

    // Process daily forecast (first 10 days)
    if (data.forecast && data.forecast.daily) {
      data.forecast.daily.slice(0, 10).forEach((forecast, index) => {
        const source = getVesselBasedSource(vesselName, 'api');
        
        // Create individual deltas for each data point
        Object.entries(forecast).forEach(([key, value]) => {
          if (value !== undefined) {
            let processedValue = value;
            const camelKey = toCamelCase(key);
            
            // Apply unit conversions
            if (key === 'air_temp_high' || key === 'air_temp_low') {
              processedValue = (value as number) + 273.15; // °C to K
            }
            
            // Add ISO datetime fields
            if (key === 'day_start_local' || key === 'sunrise' || key === 'sunset') {
              processedValue = value;
              // Also create ISO version
              const isoKey = `${toCamelCase(key)}Iso`;
              const isoValue = new Date((value as number) * 1000).toISOString();
              const isoDelta = createSignalKDelta(
                `environment.outside.tempest.forecast.daily.${isoKey}.${index}`,
                isoValue,
                source
              );
              app.handleMessage(plugin.id, isoDelta);
            }
            
            const delta = createSignalKDelta(
              `environment.outside.tempest.forecast.daily.${camelKey}.${index}`,
              processedValue,
              source
            );
            app.handleMessage(plugin.id, delta);
          }
        });
      });
    }
  }

  // Create SignalK delta message
  function createSignalKDelta(
    path: string,
    value: any,
    source: string
  ): SignalKDelta {
    const timestamp = new Date().toISOString();

    return {
      context: 'vessels.self',
      updates: [
        {
          $source: source,
          timestamp: timestamp,
          values: [
            {
              path: path,
              value: value,
            },
          ],
        },
      ],
    };
  }

  return plugin;
};
