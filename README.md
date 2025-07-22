# Zennora WeatherFlow Ingester

This SignalK plugin integrates WeatherFlow weather station, in particular the Tempest, data into your SignalK server, providing real-time weather observations, forecasts, and calculated wind data.


## Features

- **UDP Data Ingestion**: Receives real-time weather data from stations via UDP broadcasts
- **WebSocket Connection**: Connects to WeatherFlow WebSocket API for additional real-time data
- **API Integration**: Fetches forecast data from WeatherFlow REST API
- **Wind Calculations**: Calculates true wind, apparent wind, and wind chill (with Tempest) and heat index, and feels-like temperature
- **Unit Conversions**: Automatically converts units to SignalK standards (Kelvin, Pascals, radians, etc.)
- **Multiple Data Sources**: Supports Tempest, Air, and legacy WeatherFlow devices

## Installation

1. Install the plugin in your SignalK server:
   ```bash
   cd ~/,signalk/node_modules/
   npm install motamman/zennora-signalk-weatherflow
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

### Forecast Data THIS IS FIXED TO THE REGISTERED LOCATION OF THE WEATHERFLOW HUB. (If the weather station is on a boat, for example, the forecast is fixed to what might be considerd the "home port' not the vessel location.)
- `environment.outside.tempest.forecast.hourly.*` - Hourly forecast (72 hours)
- `environment.outside.tempest.forecast.daily.*` - Daily forecast (10 days)

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

## License

MIT License

