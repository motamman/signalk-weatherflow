# SignalK WeatherFlow Plugin

This SignalK plugin integrates WeatherFlow weather stations (including Tempest) into your SignalK server, providing real-time weather observations, forecasts, calculated wind data, and standardized Weather API access.

## Features

- **UDP Data Ingestion**: Receives real-time weather data from stations via UDP broadcasts
- **WebSocket Connection**: Connects to WeatherFlow WebSocket API for additional real-time data
- **API Integration**: Fetches forecast data from WeatherFlow REST API
- **Weather API Provider**: Provides standardized SignalK Weather API access to WeatherFlow data
- **Wind Calculations**: Calculates true wind, apparent wind, wind chill, heat index, and feels-like temperature
- **Unit Conversions**: Automatically converts units to SignalK standards (Kelvin, Pascals, radians, etc.)
- **Multiple Data Sources**: Supports Tempest, Air, and legacy WeatherFlow devices
- **Automatic Position Detection**: Uses vessel position for Weather API location matching
- **Lightning Warnings**: Provides weather warnings for lightning activity

## Installation

1. Install the plugin in your SignalK server:
   ```bash
   cd ~/.signalk/node_modules/
   npm install motamman/signalk-weatherflow
   ```

2. Restart your SignalK server

3. Configure the plugin through the SignalK admin interface

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

### Position Matching

The Weather API only returns data if the requested position is within:
- **50km** of the station for observations
- **100km** of the station for forecasts

The station position is automatically determined from the vessel's current `navigation.position` or can be manually configured.

### Data Format

Weather API responses follow the SignalK Weather API specification with proper unit conversions:

```json
{
  "date": "2024-01-01T12:00:00.000Z",
  "type": "observation",
  "description": "WeatherFlow tempest observation",
  "outside": {
    "temperature": 293.15,
    "pressure": 101325,
    "relativeHumidity": 0.65,
    "uvIndex": 3,
    "precipitationVolume": 0.001
  },
  "wind": {
    "speedTrue": 5.2,
    "directionTrue": 1.57,
    "gust": 7.1
  }
}
```

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
- Verify the requested position is within range of the station
- Check SignalK server logs for Weather API registration messages
- Ensure the plugin started successfully

### No Position Data for Weather API
- Verify `navigation.position` is being published to SignalK
- Check position subscription setup in plugin logs
- Consider manually configuring station coordinates as fallback

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