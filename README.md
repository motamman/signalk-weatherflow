# SignalK WeatherFlow Plugin

This SignalK plugin integrates WeatherFlow weather stations (including Tempest) into your SignalK server, providing real-time weather observations, forecasts, calculated wind data, and some standardized Weather API access.

NB: THIS IS PARTIALLY COMPLIANT WITH THE SIGNALK WEATHER API. CURRENTLY, IT IGNORES THE REQUIRED Lat and long, instead it uses the vessel's position for observations. Also, it does NOT make calls to the underlying API when a WEATHER API request is made, instead it returns the forecast data that already exists in the system. The updating of that data is entirely managed by the plugin.

Weatherflow forecast data is specific to the weather station registered location (think home port). The observation data is specific to the vessel's location. 

## Features

- **UDP Data Ingestion**: Receives real-time weather data from stations via UDP broadcasts (no internet connection required)
- **WebSocket Connection**: Connects to WeatherFlow WebSocket API for additional real-time data (internet connection required)
- **API Integration**: Fetches forecast data and current conditions from WeatherFlow REST API (internet connection required)
- **Weather API Provider**: Provides comprehensive SignalK Weather API access with enhanced WeatherFlow data
- **Wind Calculations**: Calculates true wind, apparent wind, wind chill, heat index, and feels-like temperature
- **Unit Conversions**: Automatically converts units to SignalK standards (Kelvin, Pascals, radians, etc.)
- **Multiple Data Sources**: Supports Tempest, Air, and legacy WeatherFlow devices
- **Automatic Position Detection**: Uses vessel position for Weather API location matching
- **Lightning Warnings**: Provides weather warnings for lightning activity
- **Hub & Device Status**: Monitors WeatherFlow hub and device health, connectivity, and battery levels
- **Home Port Configuration**: Easy setup of home port coordinates for forecast distance calculations

## Configuration

### Required Settings

- **Station ID**: Your WeatherFlow station ID
- **API Token**: Your WeatherFlow API token (get from [WeatherFlow Developers](https://weatherflow.github.io/SmartWeather/api/))

### Optional Settings

- **UDP Port**: Port to listen for UDP broadcasts (default: 50222)
- **Device ID**: Your WeatherFlow device ID for WebSocket connection
- **Enable WebSocket**: Connect to WeatherFlow WebSocket for real-time data
- **Enable Forecast**: Fetch forecast data from WeatherFlow API
- **Forecast Interval**: How often to fetch forecast data (minutes)
- **Enable Wind Calculations**: Calculate derived wind values
- **Enable PUT Control**: Allow external control of individual services via PUT requests
- **Station Latitude/Longitude (Optional)**: Manual coordinates for Weather API position matching (if not set, uses vessel position from `navigation.position`)
- **Set Current Location as Home Port**: Checkbox to automatically populate station coordinates with vessel's current position

### Weather API Configuration

The plugin automatically registers as a Weather API provider and uses the vessel's current position from `navigation.position` for location-based weather data requests. If you need to override this behavior, you can manually configure station coordinates in the plugin settings.

## Weather API

The plugin provides standardized access to WeatherFlow data through the SignalK Weather API endpoints:

### Endpoints

- **Observations**: `GET /signalk/v2/api/weather/observations?lat=LAT&lon=LON`
- **Point Forecasts**: `GET /signalk/v2/api/weather/forecasts/point?lat=LAT&lon=LON`
- **Daily Forecasts**: `GET /signalk/v2/api/weather/forecasts/daily?lat=LAT&lon=LON`
- **Weather Warnings**: `GET /signalk/v2/api/weather/warnings?lat=LAT&lon=LON`

### Parameters

- `lat` - Latitude (decimal degrees)
- `lon` - Longitude (decimal degrees)
- `maxCount` - Maximum number of records to return (optional)
- `startDate` - Start date for forecasts in YYYY-MM-DD format (optional)

### Weather API Implementation Limitations

**Important**: This implementation has specific behaviors that differ from typical weather APIs:

**For Observations**:
- **Position parameters are IGNORED** - The `lat` and `lon` parameters in observation requests are not used
- Always returns the vessel's current weather observations regardless of requested coordinates
- WeatherFlow station is mobile (on the boat), so vessel observations are always the most relevant
- **No new API calls** - Returns cached UDP/WebSocket observation data

**For Forecasts**:
- **Position parameters are used only for distance validation** - The `lat` and `lon` are checked against home port location
- Only returns cached forecast data if requested position is within **100km** of the configured home port
- **Forecast data is NOT location-specific** - Uses WeatherFlow's station-based forecasts tied to the station's API registration
- **No new API calls** - Returns cached data from periodic `better_forecast` API calls
- Forecasts represent weather at the station's registered location, not the requested coordinates

**For Warnings**:
- **Position parameters are IGNORED** - Returns lightning warnings from the vessel's current location only

This vessel-centric approach prioritizes marine use cases where the weather station travels with the vessel, providing immediate access to cached data without additional API costs.

### Data Format

Weather API responses follow the SignalK Weather API specification with proper unit conversions:

```json
{
  "date": "2025-09-22T00:44:38.000Z",
  "type": "observation",
  "description": "Partly Cloudy",
  "outside": {
    "temperature": 288.15,
    "pressure": 102210,
    "relativeHumidity": 0.74,
    "feelsLikeTemperature": 288.15,
    "dewPointTemperature": 283.15,
    "uvIndex": 0,
    "precipitationVolume": 0,
    "pressureTendency": "decreasing",
    "solarRadiation": 0,
    "airDensity": 1.24,
    "wetBulbTemperature": 285.15,
    "wetBulbGlobeTemperature": 289.15,
    "deltaT": 3
  },
  "wind": {
    "speedTrue": 1,
    "directionTrue": 0.61,
    "gust": 4,
    "averageSpeed": 1,
    "directionCardinal": "NE"
  }
}
```

### Enhanced Weather API Features

The WeatherFlow Weather API provider includes advanced meteorological data beyond the core SignalK specification:

**Observations Include**:
- **Core Weather Data**: Temperature, pressure, humidity, UV index, wind data
- **Comfort Indices**: Feels-like temperature, dew point, wet bulb temperature
- **Pressure Trends**: Rising, falling, or steady pressure tendency
- **Solar Data**: Solar radiation, illuminance (lux)
- **Air Quality**: Air density for aviation calculations
- **Advanced Heat Indices**: Wet bulb globe temperature, delta-T fire weather index
- **Wind Details**: Cardinal directions (N, NE, E, etc.), average vs. instantaneous speeds

**Forecasts Include**:
- **Hourly Forecasts**: 72-hour detailed forecasts with feels-like temperature, precipitation probability
- **Daily Forecasts**: 10-day forecasts with min/max temperatures, precipitation chance
- **Enhanced Wind Data**: Average wind speeds, direction in both radians and cardinal
- **Calculated Values**: Wet bulb temperature calculated from forecast temperature and humidity

**Multiple Provider Support**:
- Use `?provider=signalk-weatherflow` to explicitly request WeatherFlow data
- Compatible with other weather providers (e.g., signalk-meteo for model-based forecasts)

## External Control (PUT Operations)

The plugin supports external control of individual services via SignalK PUT requests. This allows other applications or automation systems to dynamically enable/disable specific plugin functions.

### Configuration

Enable PUT control in the plugin configuration and optionally customize the control paths:

- **Enable PUT Control**: Enable external PUT control functionality
- **WebSocket Control Path**: SignalK path for WebSocket control (default: `network.weatherflow.webSocket.state`)
- **Forecast Control Path**: SignalK path for forecast control (default: `network.weatherflow.forecast.state`)
- **Wind Calculations Control Path**: SignalK path for wind calculations control (default: `network.weatherflow.windCalculations.state`)

### Usage

Send PUT requests to the configured paths with boolean values:

```json
{
  "context": "vessels.self",
  "requestId": "unique-request-id",
  "put": {
    "path": "network.weatherflow.webSocket.state",
    "value": true
  }
}
```

### Control Paths

- **WebSocket Control** (`network.weatherflow.webSocket.state`): Enable/disable WebSocket connection
- **Forecast Control** (`network.weatherflow.forecast.state`): Enable/disable forecast data fetching
- **Wind Calculations Control** (`network.weatherflow.windCalculations.state`): Enable/disable wind calculations

### State Synchronization

- PUT changes are automatically synchronized with the admin interface checkboxes
- Changes persist across plugin restarts
- The current state is published to the control paths and can be monitored by external applications
- Configuration remains the primary source of truth, updated when PUT requests change states

## Data Paths

The plugin publishes data to the following SignalK paths:

### Weather Observations
- `environment.outside.tempest.observations.*` - Tempest station data
- `environment.inside.air.observations.*` - Air station data
- `environment.outside.rapidWind.*` - Rapid wind updates
- `environment.outside.rain.observations.*` - Rain events
- `environment.outside.lightning.observations.*` - Lightning events

### Hub & Device Status
- `network.weatherflow.hubstatus.{STATION_ID}` - Hub status (uptime, RSSI, firmware, radio stats)
- `network.weatherflow.devicestatus.{DEVICE_SERIAL}` - Device status (voltage, uptime, sensor health)

### Wind Data (if calculations enabled)
- `environment.wind.speedApparent` - Apparent wind speed
- `environment.wind.angleApparent` - Apparent wind angle
- `environment.wind.speedTrue` - True wind speed
- `environment.wind.angleTrueGround` - True wind angle (ground reference)
- `environment.wind.angleTrueWater` - True wind angle (water reference)
- `environment.wind.directionTrue` - True wind direction
- `environment.wind.directionMagnetic` - Magnetic wind direction

### Forecast Data
- `environment.outside.tempest.forecast.hourly.*` - Hourly forecast (72 hours)
- `environment.outside.tempest.forecast.daily.*` - Daily forecast (10 days)

**Note**: Forecast data is based on the WeatherFlow station's registered location, not the vessel's current position. For mobile applications, use the Weather API endpoints which can provide location-specific forecasts.

### Calculated Values
- `environment.outside.tempest.observations.windChill` - Wind chill temperature
- `environment.outside.tempest.observations.heatIndex` - Heat index
- `environment.outside.tempest.observations.feelsLike` - Feels-like temperature

## Data Types and Units

All data is automatically converted to SignalK standard units:

- **Temperature**: Celsius → Kelvin (K)
- **Pressure**: Millibars → Pascals (Pa)
- **Wind Direction**: Degrees → Radians (rad)
- **Wind Speed**: Meters per second (m/s) - no conversion needed
- **Distance**: Kilometers → Meters (m)
- **Time**: Minutes → Seconds (s)
- **Rainfall**: Millimeters → Meters (m)
- **Relative Humidity**: Percentage → Ratio (0-1)
- **Battery**: Volts (V) - no conversion needed
- **Illuminance**: Lux - no conversion needed
- **Solar Radiation**: W/m² - no conversion needed

## Wind Calculations

The plugin can calculate derived wind values using vessel navigation data:

- **True Wind**: Calculated from apparent wind and vessel motion
- **Wind Chill**: Calculated when air temperature ≤ 10°C and wind speed > 4.8 km/h
- **Heat Index**: Calculated when air temperature ≥ 27°C and humidity ≥ 40%
- **Feels Like**: Uses wind chill or heat index as appropriate

## Weather Warnings

The plugin provides weather warnings through the Weather API:

### Lightning Warnings
- Automatically generated when lightning strikes are detected
- Warning remains active for 30 minutes after the last detected strike
- Includes strike count and average distance information
- Accessible via `/signalk/v2/api/weather/warnings` endpoint

## Network Requirements

### UDP Broadcasts
The plugin listens for UDP broadcasts from WeatherFlow devices on your local network. Ensure:
- Your WeatherFlow hub is on the same network
- UDP port 50222 is accessible (or your configured port)
- No firewall blocking UDP traffic

### Internet Connectivity
For WebSocket and API features:
- Outbound HTTPS (port 443) access
- WebSocket (WSS) support
- Access to weatherflow.com domains

## Use Cases

### Fixed Weather Station
- Configure station coordinates manually for land-based installations
- Provides local weather data through standard SignalK paths
- Weather API provides consistent access for other applications

### Mobile Weather Station (Boat)
- Leave station coordinates at default (0,0) to use vessel position automatically
- Real-time weather data follows the vessel
- Weather API provides location-aware weather services
- Perfect for sailboats and other mobile marine applications

### Marine Weather Integration
- Integrates with other marine weather services
- Provides standardized weather data format
- Lightning warnings for marine safety
- Compatible with weather routing and planning applications

## Troubleshooting

### No UDP Data
- Check that WeatherFlow hub is on the same network
- Verify UDP port is not blocked by firewall
- Ensure SignalK server has network access to receive broadcasts

### WebSocket Connection Issues
- Verify API token is valid
- Check device ID is correct
- Ensure internet connectivity
- Check SignalK server logs for connection errors

### Missing Wind Calculations
- Ensure navigation data is available (heading, speed, position)
- Check that wind calculation is enabled in configuration
- Verify navigation data sources are publishing to SignalK

### Weather API Not Working
- Check that station coordinates are configured or vessel position is available
- Verify the requested position is within range of the station (forecasts only)
- Check SignalK server logs for Weather API registration messages
- Ensure the plugin started successfully
- If using multiple weather providers, specify `?provider=signalk-weatherflow` in requests
- Check which provider is default: `GET /signalk/v2/api/weather/_providers/_default`

### No Position Data for Weather API
- Verify `navigation.position` is being published to SignalK
- Check position subscription setup in plugin logs
- Consider manually configuring station coordinates as fallback
- Use "Set Current Location as Home Port" checkbox to easily configure coordinates

### Hub/Device Status Not Appearing
- Check that WeatherFlow hub is broadcasting UDP status messages
- Verify UDP port 50222 is accessible
- Look for "Unknown WeatherFlow message type" errors in logs (should be resolved)
- Check paths: `network.weatherflow.hubstatus.{STATION_ID}` and `network.weatherflow.devicestatus.{DEVICE_SERIAL}`

## Development

### Building
```bash
npm run build
```

### Formatting and Linting
```bash
npm run format
npm run lint
npm run ci  # Runs format:check and lint
```

### Testing Locally
```bash
npm run dev  # Build and watch for changes
```

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run ci` to ensure code quality
5. Submit a pull request

## License

MIT License

## Credits

Developed by Maurice Tamman for the SignalK community.

WeatherFlow and Tempest are trademarks of WeatherFlow, Inc.