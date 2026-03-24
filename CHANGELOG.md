# Changelog

All notable changes to this project will be documented in this file.

## [0.7.0] - 2026-03-23

### Changed
- Renamed `rainAccumulatedFinal` to `ncRainAccumulation` and `localDailyRainAccumulationFinal` to `localDailyNcRainAccumulation` to match official WeatherFlow API naming (NC = Near Cast / Rain Check corrected values)
- Forecast data paths restructured from `forecast.hourly.{field}.{index}` to `forecast.hourly.{index}.{field}`, grouping all fields per forecast period
- All deltas (observations, forecasts, current conditions) now use a centralized unit conversion and delta sending pipeline
- Removed duplicate inline unit conversions from forecast and current conditions processing

### Added
- `displayUnits.category` metadata on all Signal K deltas (temperature, pressure, angle, speed, length, percent, time, illuminance, irradiance, voltage, density)
- Full unit metadata for forecast deltas (hourly and daily) — previously missing
- Full unit metadata for API current conditions deltas — previously missing
- Support for all WeatherFlow forecast API fields in unit converter (`airTempHigh`, `airTempLow`, `seaLevelPressure`, `precip`, `precipProbability`, `uv`, `conditions`, `icon`, etc.)

### Fixed
- Removed indices 18-21 (Rain Check fields) from UDP processing — these fields only exist in the REST API, not the UDP broadcast, which was causing "Delta is missing value" errors
- Added null/undefined guards to all delta-sending loops to prevent missing value errors

## [0.6.1-beta.2] - 2025-12-23

### Changed
- Removed postinstall build script

## [0.6.1-beta.1] - 2025-12-23

### Changed
- Refactored temperature conversion logic for improved readability
- Enhanced data processing with unit conversions for weather conditions
- Updated package description to specify Tempest weather station

## [0.6.0-beta.1] - 2025-12-23

### Added
- Weather API provider implementation (observations, forecasts, warnings)
- Hub and device status monitoring (uptime, RSSI, firmware, radio stats, battery, sensor health)
- New interfaces for hub and device status data
- Enhanced weather data types for extended observations
- Wet bulb temperature calculation
- Weather provider types and plugin state with location data
- Enhanced Weather API documentation with implementation limitations

### Changed
- Refactored wind calculations and types to use 'unknown' for improved type safety
- Enhanced unit conversions for weather conditions (feels-like, dew point, wet bulb, etc.)

## [0.5.0-beta.1] - 2025-12-22

### Added
- PUT control functionality for external service management (WebSocket, forecast, wind calculations)
- Individual service control via SignalK PUT requests
- Persistent state management across plugin restarts
- Configuration synchronization between PUT handlers and admin interface
- CI workflow for automated testing and build process

### Changed
- Refactored PUT handler registration to use Map for improved management
- Service state initialization always reflects configuration settings

## [0.5.0-alpha.2] - 2025-12-22

### Changed
- Refactored forecast processing to use dynamic key handling
- Improved unit conversion logic for forecasts
- Added utility function to convert underscore_case to camelCase

## [0.5.0-alpha.1] - 2025-12-22

### Changed
- Renamed package from `zennora-signalk-weatherflow` to `signalk-weatherflow`
- Updated plugin ID and name to reflect new branding
- Updated default prefix in index.ts

## [0.1.0] - 2025-12-21

### Added
- Initial release
- UDP data ingestion from WeatherFlow stations
- WebSocket connection to WeatherFlow API
- Forecast data fetching from REST API
- Wind calculations (true wind, apparent wind, wind chill, heat index, feels-like)
- Unit conversions to SignalK standards
- Support for Tempest, Air, and legacy WeatherFlow devices
- Lightning event processing
- Rain event processing
- Rapid wind updates
