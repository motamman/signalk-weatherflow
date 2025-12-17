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
  HubStatusData,
  DeviceStatusData,
  WebSocketMessage,
  ForecastData,
  ProcessedWindData,
  ProcessedTempestData,
  ProcessedAirData,
  ProcessedRainData,
  ProcessedLightningData,
  ProcessedHubStatusData,
  ProcessedDeviceStatusData,
  ConvertedValue,
  SignalKDelta,
  SubscriptionRequest,
  WindInput,
  PutHandler,
  WeatherProvider,
  WeatherData,
  WeatherReqParams,
  WeatherForecastType,
  WeatherWarning,
  Position,
  TendencyKind,
  PrecipitationKind,
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
    latestObservations: new Map(),
    latestForecastData: null,
    stationLocation: null,
    currentVesselPosition: null,
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
        description:
          'Allow external control of individual plugin services via PUT requests',
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
      stationLatitude: {
        type: 'number',
        title: 'Station Latitude (Optional)',
        description:
          'Weather station latitude for Weather API position matching. If not set (0), will use vessel position from navigation.position',
        default: 0,
      },
      stationLongitude: {
        type: 'number',
        title: 'Station Longitude (Optional)',
        description:
          'Weather station longitude for Weather API position matching. If not set (0), will use vessel position from navigation.position',
        default: 0,
      },
      setCurrentLocationAction: {
        type: 'object',
        title: 'Home Port Location Actions',
        description: 'Actions for setting the home port location',
        properties: {
          setCurrentLocation: {
            type: 'boolean',
            title: 'Set Current Location as Home Port',
            description:
              "Check this box and save to use the vessel's current position as the home port coordinates",
            default: false,
          },
        },
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
    return require('path').join(
      app.getDataDirPath(),
      'signalk-weatherflow-state.json'
    );
  }

  function savePersistedState(): void {
    try {
      const fs = require('fs');
      const stateToSave = {
        webSocketEnabled: state.webSocketEnabled,
        forecastEnabled: state.forecastEnabled,
        windCalculationsEnabled: state.windCalculationsEnabled,
      };
      fs.writeFileSync(
        getStateFilePath(),
        JSON.stringify(stateToSave, null, 2)
      );
    } catch (error) {
      app.error('Could not save persisted state: ' + (error as Error).message);
    }
  }

  // Update plugin configuration to match current state
  function updatePluginConfig(): void {
    if (!state.currentConfig) return;

    const updatedConfig = {
      ...state.currentConfig,
      enableWebSocket: state.webSocketEnabled,
      enableForecast: state.forecastEnabled,
      enableWindCalculations: state.windCalculationsEnabled,
    };

    app.savePluginOptions(updatedConfig, (err?: any) => {
      if (err) {
        app.error('Could not save plugin configuration: ' + err.message);
      } else {
        app.debug('Plugin configuration updated to match PUT state changes');
        state.currentConfig = updatedConfig;
      }
    });
  }

  // Setup PUT control for individual service control
  function setupPutControl(config: PluginConfig): void {
    const controlPaths = [
      { path: config.webSocketControlPath, service: 'webSocket' },
      { path: config.forecastControlPath, service: 'forecast' },
      { path: config.windCalculationsControlPath, service: 'windCalculations' },
    ];

    controlPaths.forEach(({ path, service }) => {
      // Create PUT handler
      const putHandler: PutHandler = (
        context: string,
        requestPath: string,
        value: any,
        callback?: (result: { state: string; statusCode?: number }) => void
      ): { state: string; statusCode?: number } => {
        app.debug(
          `PUT request received for ${requestPath} with value: ${JSON.stringify(value)}`
        );

        if (requestPath === path) {
          const newState = Boolean(value);
          handleServiceControl(service, newState, config);

          // Save the new state to persist across restarts
          savePersistedState();

          // Update plugin configuration so checkboxes reflect the change
          updatePluginConfig();

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
  function handleServiceControl(
    service: string,
    newState: boolean,
    config: PluginConfig
  ): void {
    const currentState = getServiceState(service);

    if (newState !== currentState) {
      app.debug(
        `${newState ? 'Enabling' : 'Disabling'} ${service} via PUT control`
      );

      if (service === 'webSocket') {
        state.webSocketEnabled = newState;
        if (newState && config.enableWebSocket && config.apiToken) {
          startWebSocketConnection(
            config.apiToken,
            config.deviceId,
            config.vesselName
          );
        } else if (!newState && state.wsConnection) {
          state.wsConnection.close();
          state.wsConnection = null;
        }
      } else if (service === 'forecast') {
        state.forecastEnabled = newState;
        if (
          newState &&
          config.enableForecast &&
          config.apiToken &&
          config.stationId
        ) {
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

      app.setProviderStatus(
        `WeatherFlow ${service} ${newState ? 'enabled' : 'disabled'} via external control`
      );
    }
  }

  // Get current state of a service
  function getServiceState(service: string): boolean {
    switch (service) {
      case 'webSocket':
        return state.webSocketEnabled;
      case 'forecast':
        return state.forecastEnabled;
      case 'windCalculations':
        return state.windCalculationsEnabled;
      default:
        return false;
    }
  }

  // Start plugin services (factored out for PUT control)
  function startPluginServices(config: PluginConfig): void {
    // Set up position subscription for Weather API
    setupPositionSubscription();

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
    if (
      config.enableForecast &&
      config.apiToken &&
      config.stationId &&
      state.forecastEnabled
    ) {
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

  // Handle "Set Current Location" action
  async function handleSetCurrentLocationAction(
    config: PluginConfig
  ): Promise<void> {
    app.debug(
      `handleSetCurrentLocationAction called with setCurrentLocation: ${config.setCurrentLocationAction?.setCurrentLocation}`
    );

    if (config.setCurrentLocationAction?.setCurrentLocation) {
      // First try cached position
      let currentPosition = getCurrentVesselPosition();
      app.debug(
        `Cached position: ${currentPosition ? `${currentPosition.latitude}, ${currentPosition.longitude}` : 'null'}`
      );

      // If no cached position, try to fetch from SignalK API directly
      if (!currentPosition) {
        app.debug('No cached position, trying to fetch from SignalK API...');
        try {
          const response = await fetch(
            'http://localhost:3000/signalk/v1/api/vessels/self/navigation/position'
          );
          if (response.ok) {
            const positionData = await response.json();
            if (
              positionData.value &&
              positionData.value.latitude &&
              positionData.value.longitude
            ) {
              currentPosition = {
                latitude: positionData.value.latitude,
                longitude: positionData.value.longitude,
                timestamp: new Date(positionData.timestamp || Date.now()),
              };
              app.debug(
                `Fetched position from API: ${currentPosition.latitude}, ${currentPosition.longitude}`
              );
            }
          }
        } catch (error) {
          app.debug(`Failed to fetch position from API: ${error}`);
        }
      }

      if (currentPosition) {
        // Update the configuration with current position
        const updatedConfig = {
          ...config,
          stationLatitude: currentPosition.latitude,
          stationLongitude: currentPosition.longitude,
          setCurrentLocationAction: {
            setCurrentLocation: false, // Reset the checkbox
          },
        };

        // Save the updated configuration
        app.savePluginOptions(updatedConfig, (err?: unknown) => {
          if (err) {
            app.error(`Failed to save current location as home port: ${err}`);
          } else {
            app.debug(
              `Set home port location to: ${currentPosition!.latitude}, ${currentPosition!.longitude}`
            );

            // Update the state with new station location
            state.stationLocation = {
              latitude: currentPosition!.latitude,
              longitude: currentPosition!.longitude,
              timestamp: new Date(),
            };

            // Update current config
            state.currentConfig = updatedConfig;
            plugin.config = updatedConfig;
          }
        });
      } else {
        app.error(
          'No current vessel position available. Ensure navigation.position is being published to SignalK.'
        );
      }
    }
  }

  // Weather API Provider Implementation
  const weatherProvider: WeatherProvider = {
    name: 'WeatherFlow Station Weather Provider',
    methods: {
      pluginId: 'signalk-weatherflow',

      getObservations: async (
        _position: Position,
        options?: WeatherReqParams
      ): Promise<WeatherData[]> => {
        const observations: WeatherData[] = [];

        // WeatherFlow station is ON THE BOAT - always return current observations
        // regardless of requested position since the station moves with the vessel
        for (const [type, data] of state.latestObservations) {
          if (data && data.timestamp) {
            const weatherData = convertObservationToWeatherAPI(type, data);
            observations.push(weatherData);
          }
        }

        // Apply maxCount limit if specified
        if (options?.maxCount && observations.length > options.maxCount) {
          return observations.slice(0, options.maxCount);
        }

        return observations;
      },

      getForecasts: async (
        position: Position,
        type: WeatherForecastType,
        options?: WeatherReqParams
      ): Promise<WeatherData[]> => {
        const forecasts: WeatherData[] = [];

        // For forecasts, check if requested position is near the station's registered location
        // since forecasts are location-specific and tied to the station's API registration
        const stationPos = getStationLocation();
        const distance = calculateDistance(position, stationPos);
        const maxDistance = 100000; // 100km radius for forecasts

        if (distance > maxDistance) {
          app.debug(
            `Requested position too far from station's registered location for forecasts: ${distance}m`
          );
          return forecasts;
        }

        if (!state.latestForecastData) {
          app.debug('No forecast data available');
          return forecasts;
        }

        try {
          if (type === 'point' && state.latestForecastData.forecast?.hourly) {
            // Convert hourly forecasts
            const hourlyForecasts =
              state.latestForecastData.forecast.hourly.slice(0, 72); // 72 hours
            for (const forecast of hourlyForecasts) {
              const weatherData = convertForecastToWeatherAPI(
                forecast,
                'point'
              );
              forecasts.push(weatherData);
            }
          } else if (
            type === 'daily' &&
            state.latestForecastData.forecast?.daily
          ) {
            // Convert daily forecasts
            const dailyForecasts =
              state.latestForecastData.forecast.daily.slice(0, 10); // 10 days
            for (const forecast of dailyForecasts) {
              const weatherData = convertForecastToWeatherAPI(
                forecast,
                'daily'
              );
              forecasts.push(weatherData);
            }
          }

          // Apply date filtering if startDate specified
          if (options?.startDate) {
            const startTime = new Date(options.startDate).getTime();
            return forecasts.filter(
              f => new Date(f.date).getTime() >= startTime
            );
          }

          // Apply maxCount limit if specified
          if (options?.maxCount && forecasts.length > options.maxCount) {
            return forecasts.slice(0, options.maxCount);
          }
        } catch (error) {
          app.error(
            `Error processing forecast data: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        return forecasts;
      },

      getWarnings: async (_position: Position): Promise<WeatherWarning[]> => {
        const warnings: WeatherWarning[] = [];

        // Check for lightning warnings based on recent strikes
        const lightningData = state.latestObservations.get('tempest');
        if (lightningData && lightningData.lightningStrikeCount > 0) {
          const lastStrikeTime = new Date(lightningData.timeEpoch * 1000);
          const warningEndTime = new Date(
            lastStrikeTime.getTime() + 30 * 60 * 1000
          ); // 30 minutes after last strike

          if (new Date() < warningEndTime) {
            warnings.push({
              startTime: lastStrikeTime.toISOString(),
              endTime: warningEndTime.toISOString(),
              details: `Lightning activity detected. ${lightningData.lightningStrikeCount} strikes recorded. Last strike at average distance of ${Math.round(lightningData.lightningStrikeAvgDistance)}m.`,
              source: 'WeatherFlow Station',
              type: 'lightning',
            });
          }
        }

        return warnings;
      },
    },
  };

  // Plugin start function
  plugin.start = function (options: Partial<PluginConfig>): void {
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
      webSocketControlPath:
        options.webSocketControlPath || 'network.weatherflow.webSocket.state',
      forecastControlPath:
        options.forecastControlPath || 'network.weatherflow.forecast.state',
      windCalculationsControlPath:
        options.windCalculationsControlPath ||
        'network.weatherflow.windCalculations.state',
      stationLatitude: options.stationLatitude || 0,
      stationLongitude: options.stationLongitude || 0,
      setCurrentLocationAction: options.setCurrentLocationAction || {
        setCurrentLocation: false,
      },
    };

    state.currentConfig = config;
    plugin.config = config;

    // Set station location for Weather API
    if (config.stationLatitude !== 0 && config.stationLongitude !== 0) {
      state.stationLocation = {
        latitude: config.stationLatitude!,
        longitude: config.stationLongitude!,
        timestamp: new Date(),
      };
    }

    // Initialize service states from configuration
    // Config is now the primary source of truth, kept in sync by PUT handlers
    state.webSocketEnabled = config.enableWebSocket;
    state.forecastEnabled = config.enableForecast;
    state.windCalculationsEnabled = config.enableWindCalculations;

    // Start plugin services
    startPluginServices(config);

    // Handle "Set Current Location" action
    handleSetCurrentLocationAction(config).catch(err => {
      app.error(`Error handling set current location action: ${err}`);
    });

    // Register as Weather API provider
    try {
      app.registerWeatherProvider(weatherProvider);
      app.debug('Successfully registered WeatherFlow as Weather API provider');
    } catch (error) {
      app.error(
        `Failed to register Weather API provider: ${error instanceof Error ? error.message : String(error)}`
      );
    }

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

  // Set up position subscription for Weather API
  function setupPositionSubscription(): void {
    const positionSubscription: SubscriptionRequest = {
      context: 'vessels.self',
      subscribe: [
        {
          path: 'navigation.position',
          policy: 'fixed',
          period: 5000, // Update every 5 seconds
          format: 'delta',
        },
      ],
    };

    app.subscriptionmanager.subscribe(
      positionSubscription,
      state.navigationSubscriptions,
      (subscriptionError: unknown) => {
        app.debug('Position subscription error: ' + subscriptionError);
      },
      (delta: any) => {
        handlePositionData(delta);
      }
    );
  }

  // Handle position data updates
  function handlePositionData(delta: any): void {
    if (!delta.updates) return;

    delta.updates.forEach((update: any) => {
      if (!update.values) return;

      update.values.forEach((valueUpdate: any) => {
        if (valueUpdate.path === 'navigation.position' && valueUpdate.value) {
          const position = valueUpdate.value;
          if (
            position.latitude !== undefined &&
            position.longitude !== undefined
          ) {
            state.currentVesselPosition = {
              latitude: position.latitude,
              longitude: position.longitude,
              timestamp: new Date(update.timestamp || Date.now()),
            };
            app.debug(
              `Updated vessel position: ${position.latitude}, ${position.longitude}`
            );
          }
        }
      });
    });
  }

  // Start UDP server for WeatherFlow broadcasts
  function startUdpServer(port: number, config: PluginConfig): void {
    state.udpServer = dgram.createSocket('udp4');

    state.udpServer.on('message', (msg: Buffer, _rinfo: dgram.RemoteInfo) => {
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
      case 'hub_status':
        processHubStatus(data as HubStatusData, config);
        break;
      case 'device_status':
        processDeviceStatus(data as DeviceStatusData, config);
        break;
      default:
        app.debug('Unknown WeatherFlow message type: ' + data.type);
    }
  }

  // Helper function to convert snake_case to camelCase
  function snakeToCamel(str: string): string {
    return str.replace(/_([a-z0-9])/g, (_match, letter) =>
      letter.toUpperCase()
    );
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

  // Cache latest observation data for Weather API
  function cacheObservationData(type: string, data: any): void {
    state.latestObservations.set(type, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // Cache forecast data for Weather API
  function cacheForecastData(data: ForecastData): void {
    state.latestForecastData = data;
  }

  // Convert WeatherFlow observation to Weather API format
  function convertObservationToWeatherAPI(
    observationType: string,
    data: any
  ): WeatherData {
    const baseWeatherData: WeatherData = {
      date:
        data.utcDate ||
        new Date(data.time ? data.time * 1000 : Date.now()).toISOString(),
      type: 'observation',
      description:
        data.conditions || `WeatherFlow ${observationType} observation`,
    };

    // Prioritize currentConditions (REST API) data - much richer than UDP
    if (observationType === 'currentConditions') {
      baseWeatherData.outside = {
        temperature: data.air_temperature + 273.15, // Convert °C to K
        pressure: data.sea_level_pressure
          ? data.sea_level_pressure * 100
          : data.station_pressure * 100, // Convert MB to Pa
        relativeHumidity: data.relative_humidity / 100, // Convert % to ratio 0-1
        feelsLikeTemperature: data.feels_like + 273.15, // Convert °C to K
        dewPointTemperature: data.dew_point + 273.15, // Convert °C to K
        uvIndex: data.uv,
        precipitationVolume: 0, // Current conditions doesn't have accumulation
        pressureTendency: mapPressureTendency(data.pressure_trend),
        // Extended WeatherFlow fields
        solarRadiation: data.solar_radiation, // W/m²
        airDensity: data.air_density, // kg/m³
        wetBulbTemperature: data.wet_bulb_temperature
          ? data.wet_bulb_temperature + 273.15
          : undefined, // Convert °C to K
        wetBulbGlobeTemperature: data.wet_bulb_globe_temperature
          ? data.wet_bulb_globe_temperature + 273.15
          : undefined, // Convert °C to K
        deltaT: data.delta_t, // °C (fire weather index)
      };

      baseWeatherData.wind = {
        speedTrue: data.wind_avg, // Already in m/s
        directionTrue: (data.wind_direction * Math.PI) / 180, // Convert degrees to radians
        gust: data.wind_gust, // Already in m/s
        averageSpeed: data.wind_avg, // Already in m/s
        directionCardinal: data.wind_direction_cardinal, // E, W, NE, etc.
      };
    }
    // Convert Tempest observation data (UDP fallback)
    else if (observationType === 'tempest') {
      baseWeatherData.outside = {
        temperature: data.airTemperature, // Already in Kelvin
        pressure: data.stationPressure, // Already in Pascal
        relativeHumidity: data.relativeHumidity, // Already as ratio 0-1
        uvIndex: data.uvIndex,
        precipitationVolume: data.rainAccumulated, // Already in meters
        precipitationType: mapPrecipitationType(data.precipitationType),
        // Extended WeatherFlow fields from UDP
        solarRadiation: data.solarRadiation, // W/m²
        illuminance: data.illuminance, // lux
      };

      baseWeatherData.wind = {
        speedTrue: data.windAvg, // Already in m/s
        directionTrue: data.windDirection, // Already in radians
        gust: data.windGust, // Already in m/s
        averageSpeed: data.windAvg, // Already in m/s
      };
    }

    // Convert rapid wind data
    if (observationType === 'rapidWind') {
      baseWeatherData.wind = {
        speedTrue: data.windSpeed, // Already in m/s
        directionTrue: data.windDirection, // Already in radians
      };
    }

    // Convert air station data (UDP)
    else if (observationType === 'air') {
      baseWeatherData.outside = {
        temperature: data.airTemperature, // Already in Kelvin from UDP processing
        pressure: data.stationPressure, // Already in Pascal from UDP processing
        relativeHumidity: data.relativeHumidity, // Already as ratio 0-1 from UDP processing
      };
    }

    return baseWeatherData;
  }

  // Convert WeatherFlow forecast to Weather API format
  function convertForecastToWeatherAPI(
    forecast: any,
    type: WeatherForecastType
  ): WeatherData {
    const baseWeatherData: WeatherData = {
      date: forecast.datetime || new Date(forecast.time * 1000).toISOString(),
      type: type,
      description: forecast.conditions || `WeatherFlow ${type} forecast`,
    };

    if (type === 'point') {
      // Hourly forecast - use != null to handle 0°C correctly
      baseWeatherData.outside = {
        temperature:
          forecast.air_temperature != null
            ? forecast.air_temperature + 273.15
            : undefined, // Convert °C to K
        feelsLikeTemperature:
          forecast.feels_like != null
            ? forecast.feels_like + 273.15
            : undefined,
        relativeHumidity: forecast.relative_humidity
          ? forecast.relative_humidity / 100
          : undefined, // Convert % to ratio
        precipitationVolume: forecast.precip
          ? forecast.precip / 1000
          : undefined, // Convert mm to m
        pressure: forecast.sea_level_pressure
          ? forecast.sea_level_pressure * 100
          : forecast.station_pressure
            ? forecast.station_pressure * 100
            : undefined, // Prefer sea level, fallback to station pressure (MB to Pa)
        uvIndex: forecast.uv,
        // Extended WeatherFlow forecast fields
        wetBulbTemperature: calculateWetBulbTemperature(
          forecast.air_temperature,
          forecast.relative_humidity
        ),
        precipitationProbability: forecast.precip_probability
          ? forecast.precip_probability / 100
          : undefined, // Convert % to ratio 0-1
      };

      baseWeatherData.wind = {
        speedTrue: forecast.wind_avg, // Already in m/s
        directionTrue: forecast.wind_direction
          ? forecast.wind_direction * (Math.PI / 180)
          : undefined, // Convert deg to rad
        gust: forecast.wind_gust,
        averageSpeed: forecast.wind_avg, // Same as speedTrue for consistency
      };
    } else if (type === 'daily') {
      // Daily forecast
      baseWeatherData.outside = {
        maxTemperature: forecast.air_temp_high
          ? forecast.air_temp_high + 273.15
          : undefined,
        minTemperature: forecast.air_temp_low
          ? forecast.air_temp_low + 273.15
          : undefined,
        precipitationType: mapPrecipitationType(forecast.precip_type),
        precipitationProbability: forecast.precip_probability
          ? forecast.precip_probability / 100
          : undefined, // Convert % to ratio 0-1
      };

      baseWeatherData.wind = {
        speedTrue: forecast.wind_avg,
        directionTrue: forecast.wind_direction
          ? forecast.wind_direction * (Math.PI / 180)
          : undefined,
        averageSpeed: forecast.wind_avg, // Same as speedTrue for consistency
      };

      if (forecast.sunrise_iso && forecast.sunset_iso) {
        baseWeatherData.sun = {
          sunrise: forecast.sunrise_iso,
          sunset: forecast.sunset_iso,
        };
      }
    }

    return baseWeatherData;
  }

  // Map WeatherFlow precipitation type to Weather API format
  function mapPrecipitationType(
    precipType: number | string
  ): PrecipitationKind {
    if (typeof precipType === 'string') {
      switch (precipType.toLowerCase()) {
        case 'rain':
          return 'rain';
        case 'snow':
          return 'snow';
        case 'thunderstorm':
          return 'thunderstorm';
        default:
          return 'not available';
      }
    }

    // WeatherFlow numeric precipitation types
    switch (precipType) {
      case 0:
        return 'not available';
      case 1:
        return 'rain';
      case 2:
        return 'snow';
      case 3:
        return 'mixed/ice';
      default:
        return 'not available';
    }
  }

  // Map pressure trend string to SignalK format
  function mapPressureTendency(pressureTrend: string): TendencyKind {
    switch (pressureTrend) {
      case 'falling':
        return 'decreasing';
      case 'rising':
        return 'increasing';
      case 'steady':
        return 'steady';
      default:
        return 'steady';
    }
  }

  // Calculate wet bulb temperature from air temperature and relative humidity
  function calculateWetBulbTemperature(
    tempC: number,
    relativeHumidity: number
  ): number | undefined {
    if (tempC == null || relativeHumidity == null) return undefined;

    // Simple approximation of wet bulb temperature (Stull formula)
    // More accurate calculation would require iterative approach
    const rh = relativeHumidity / 100; // Convert % to ratio if needed
    const tw =
      tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
      Math.atan(tempC + rh) -
      Math.atan(rh - 1.676331) +
      0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
      4.686035;

    return tw + 273.15; // Convert to Kelvin
  }

  // Get station location from vessel's current position or fallback to configured coordinates
  function getStationLocation(): Position {
    // First try to get current vessel position
    const vesselPosition = getCurrentVesselPosition();
    if (vesselPosition) {
      return vesselPosition;
    }

    // Fallback to manually configured station location
    return (
      state.stationLocation || {
        latitude: 0, // Default coordinates if nothing is configured
        longitude: 0, // Default coordinates if nothing is configured
        timestamp: new Date(),
      }
    );
  }

  // Get current vessel position from cached state
  function getCurrentVesselPosition(): Position | null {
    return state.currentVesselPosition;
  }

  // Calculate distance between two positions (haversine formula)
  function calculateDistance(pos1: Position, pos2: Position): number {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (pos1.latitude * Math.PI) / 180;
    const φ2 = (pos2.latitude * Math.PI) / 180;
    const Δφ = ((pos2.latitude - pos1.latitude) * Math.PI) / 180;
    const Δλ = ((pos2.longitude - pos1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
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

    // Cache data for Weather API (with unit conversions applied)
    const weatherApiData = {
      ...windData,
      windDirection: (windDirection * Math.PI) / 180, // Convert degrees to radians
    };
    cacheObservationData('rapidWind', weatherApiData);

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

    // Cache data for Weather API (with unit conversions applied)
    const weatherApiData = {
      ...observationData,
      windDirection: (obs[4] * Math.PI) / 180, // Convert degrees to radians
      stationPressure: obs[6] * 100, // Convert mbar to Pa
      airTemperature: obs[7] + 273.15, // Convert °C to K
      relativeHumidity: obs[8] / 100, // Convert % to ratio 0-1
      rainAccumulated: obs[12] / 1000, // Convert mm to m
      lightningStrikeAvgDistance: obs[14] * 1000, // Convert km to m
      localDailyRainAccumulation: obs[18] / 1000, // Convert mm to m
      rainAccumulatedFinal: obs[19] / 1000, // Convert mm to m
      localDailyRainAccumulationFinal: obs[20] / 1000, // Convert mm to m
    };
    cacheObservationData('tempest', weatherApiData);

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

    // Cache data for Weather API (with unit conversions applied)
    const weatherApiData = {
      ...observationData,
      stationPressure: obs[1] * 100, // Convert mbar to Pa
      airTemperature: obs[2] + 273.15, // Convert °C to K
      relativeHumidity: obs[3] / 100, // Convert % to ratio 0-1
    };
    cacheObservationData('air', weatherApiData);

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

  // Process hub status messages
  function processHubStatus(data: HubStatusData, config: PluginConfig): void {
    if (!data.serial_number || !data.timestamp) return;

    const hubStatusData: ProcessedHubStatusData = {
      timeEpoch: data.timestamp,
      serialNumber: data.serial_number,
      firmwareRevision: data.firmware_revision,
      uptime: data.uptime,
      rssi: data.rssi,
      resetFlags: data.reset_flags,
      sequence: data.seq,
      radioStats: {
        version: data.radio_stats[0] || 0,
        rebootCount: data.radio_stats[1] || 0,
        busErrorCount: data.radio_stats[2] || 0,
        radioStatus: data.radio_stats[3] || 0,
        networkId: data.radio_stats[4] || 0,
      },
      utcDate: new Date(data.timestamp * 1000).toISOString(),
    };

    // Send complete hub status as a single object
    const timestamp = hubStatusData.utcDate;
    const source = getVesselBasedSource(config.vesselName, 'udp');
    const path = `network.weatherflow.hubstatus.${config.stationId}`;

    // Create complete hub status object (excluding utcDate and timeEpoch)
    const hubStatusObject = {
      serialNumber: hubStatusData.serialNumber,
      firmwareRevision: hubStatusData.firmwareRevision,
      uptime: hubStatusData.uptime,
      rssi: hubStatusData.rssi,
      resetFlags: hubStatusData.resetFlags,
      sequence: hubStatusData.sequence,
      radioStats: hubStatusData.radioStats,
    };

    // Send as single SignalK delta
    const delta: SignalKDelta = {
      context: 'vessels.self',
      updates: [
        {
          $source: source,
          timestamp,
          values: [
            {
              path,
              value: hubStatusObject,
            },
          ],
        },
      ],
    };

    app.handleMessage('signalk-weatherflow', delta);

    app.debug(
      `Hub status processed for station ${config.stationId}: uptime=${hubStatusData.uptime}s, rssi=${hubStatusData.rssi}dBm`
    );
  }

  // Process device status messages
  function processDeviceStatus(
    data: DeviceStatusData,
    config: PluginConfig
  ): void {
    if (!data.serial_number || !data.timestamp) return;

    const deviceStatusData: ProcessedDeviceStatusData = {
      timeEpoch: data.timestamp,
      serialNumber: data.serial_number,
      hubSerialNumber: data.hub_sn,
      uptime: data.uptime,
      voltage: data.voltage,
      firmwareRevision: data.firmware_revision,
      rssi: data.rssi,
      hubRssi: data.hub_rssi,
      sensorStatus: data.sensor_status,
      debugEnabled: data.debug === 1,
      utcDate: new Date(data.timestamp * 1000).toISOString(),
    };

    // Send complete device status as a single object
    const timestamp = deviceStatusData.utcDate;
    const source = getVesselBasedSource(config.vesselName, 'udp');
    const path = `network.weatherflow.devicestatus.${data.serial_number}`;

    // Create complete device status object (excluding utcDate and timeEpoch)
    const deviceStatusObject = {
      serialNumber: deviceStatusData.serialNumber,
      hubSerialNumber: deviceStatusData.hubSerialNumber,
      uptime: deviceStatusData.uptime,
      voltage: deviceStatusData.voltage,
      firmwareRevision: deviceStatusData.firmwareRevision,
      rssi: deviceStatusData.rssi,
      hubRssi: deviceStatusData.hubRssi,
      sensorStatus: deviceStatusData.sensorStatus,
      debugEnabled: deviceStatusData.debugEnabled,
    };

    // Send as single SignalK delta
    const delta: SignalKDelta = {
      context: 'vessels.self',
      updates: [
        {
          $source: source,
          timestamp,
          values: [
            {
              path,
              value: deviceStatusObject,
            },
          ],
        },
      ],
    };

    app.handleMessage('signalk-weatherflow', delta);

    app.debug(
      `Device status processed for ${data.serial_number}: uptime=${deviceStatusData.uptime}s, voltage=${deviceStatusData.voltage}V, rssi=${deviceStatusData.rssi}dBm`
    );
  }

  // Process forecast data
  function processForecastData(data: ForecastData, vesselName?: string): void {
    // Cache forecast data for Weather API
    cacheForecastData(data);

    // Check if forecast processing is enabled
    if (!state.forecastEnabled) {
      return;
    }
    // Process current conditions
    if (data.current_conditions) {
      // Cache current conditions for Weather API (richer data than UDP)
      cacheObservationData('currentConditions', data.current_conditions);

      // Convert current conditions to SignalK units
      const source = getVesselBasedSource(vesselName, 'api');
      Object.entries(data.current_conditions).forEach(([key, value]) => {
        if (value !== undefined) {
          let processedValue = value;
          const camelKey = toCamelCase(key);

          // Apply unit conversions
          if (
            key === 'air_temperature' ||
            key === 'feels_like' ||
            key === 'dew_point' ||
            key === 'wet_bulb_temperature' ||
            key === 'wet_bulb_globe_temperature'
          ) {
            processedValue = (value as number) + 273.15; // °C to K
          } else if (
            key === 'sea_level_pressure' ||
            key === 'station_pressure'
          ) {
            processedValue = (value as number) * 100; // MB to Pa
          } else if (key === 'wind_direction') {
            processedValue = ((value as number) * Math.PI) / 180; // degrees to radians
          } else if (key === 'relative_humidity') {
            processedValue = (value as number) / 100; // % to ratio
          }

          const delta = createSignalKDelta(
            `environment.outside.tempest.observations.${camelKey}`,
            processedValue,
            source
          );
          app.handleMessage(plugin.id, delta);
        }
      });
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
            } else if (
              key === 'sea_level_pressure' ||
              key === 'station_pressure'
            ) {
              processedValue = (value as number) * 100; // MB to Pa
            } else if (key === 'wind_direction') {
              processedValue = ((value as number) * Math.PI) / 180; // degrees to radians
            } else if (
              key === 'relative_humidity' ||
              key === 'precip_probability'
            ) {
              processedValue = (value as number) / 100; // % to ratio
            } else if (key === 'precip') {
              processedValue = (value as number) / 1000; // mm to m
            }

            // Add datetime field for time
            if (key === 'time') {
              processedValue = value;
              // Also create datetime version
              const datetimeValue = new Date(
                (value as number) * 1000
              ).toISOString();
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
            } else if (
              key === 'sea_level_pressure' ||
              key === 'station_pressure'
            ) {
              processedValue = (value as number) * 100; // MB to Pa
            } else if (key === 'wind_direction') {
              processedValue = ((value as number) * Math.PI) / 180; // degrees to radians
            } else if (
              key === 'relative_humidity' ||
              key === 'precip_probability'
            ) {
              processedValue = (value as number) / 100; // % to ratio
            }

            // Add ISO datetime fields
            if (
              key === 'day_start_local' ||
              key === 'sunrise' ||
              key === 'sunset'
            ) {
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
