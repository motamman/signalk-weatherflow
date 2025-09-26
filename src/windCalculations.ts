import {
  SignalKApp,
  WindInput,
  ApparentWindData,
  DerivedWindValues,
  SignalKDelta,
} from './types';

export class WindCalculations {
  private app: SignalKApp;
  private headingTrue: number = 0;
  private headingMagnetic: number = 0;
  private courseOverGroundMagnetic: number | null = null;
  private speedOverGround: number = 0;
  public airTemp: number = 0;
  private humidity: number = 0;
  private anchorSet: boolean = false;
  private anchorApparentBearing: number = 0;
  private vesselName: string | undefined;

  constructor(app: SignalKApp, vesselName?: string) {
    this.app = app;
    this.vesselName = vesselName;
  }

  // Utility method to format name according to source naming rules
  private formatSourceName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Utility method to get formatted vessel name for source
  private getVesselBasedSource(suffix: string): string {
    // Use configured prefix if provided, otherwise default to "zennora"
    const vesselPrefix =
      this.vesselName && this.vesselName.trim() ? this.vesselName : 'zennora';
    const formattedName = this.formatSourceName(vesselPrefix);
    return `${formattedName}-weatherflow-${suffix}`;
  }

  // Helper function to convert degrees to radians
  private degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  // Helper function to convert radians to degrees
  private radToDeg(rad: number): number {
    return (rad * 180) / Math.PI;
  }

  // Helper function: normalize angle to [-π, π]
  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  // Helper function to convert atan2 result to compass bearing [0, 2π]
  private toCompassBearing(radians: number): number {
    return radians < 0 ? radians + 2 * Math.PI : radians;
  }

  // Update navigation data from SignalK
  updateNavigationData(path: string, value: number): void {
    switch (path) {
      case 'navigation.headingTrue':
        this.headingTrue = value;
        break;
      case 'navigation.headingMagnetic':
        this.headingMagnetic = value;
        break;
      case 'navigation.courseOverGroundMagnetic':
        this.courseOverGroundMagnetic = value;
        break;
      case 'navigation.speedOverGround':
        this.speedOverGround = value;
        break;
      case 'environment.outside.tempest.observations.airTemperature':
        this.airTemp = value;
        break;
      case 'environment.outside.tempest.observations.relativeHumidity':
        this.humidity = value;
        break;
    }
  }

  // Calculate apparent wind values
  calculateApparentWind(windData: WindInput): ApparentWindData {
    // Calculate apparent wind angles and directions
    const headingTrueDeg = this.radToDeg(this.headingTrue);
    const headingMagneticDeg = this.radToDeg(this.headingMagnetic);

    // Wind angle - relative to bow
    const windAngleRelative = windData.windDirection;
    const windAngleRelativeRad = this.degToRad(windData.windDirection);

    // Wind direction - calculate absolute compass direction
    const apparentTrueDeg = (headingTrueDeg + windData.windDirection) % 360;
    const apparentMagneticDeg =
      (headingMagneticDeg + windData.windDirection) % 360;

    return {
      windSpeed: windData.windSpeed,
      windAngleRelative,
      windAngleRelativeRad,
      apparentTrueDeg,
      apparentMagneticDeg,
      apparentTrueRad: this.degToRad(apparentTrueDeg),
      apparentMagneticRad: this.degToRad(apparentMagneticDeg),
      airTemperature: windData.airTemperature || this.airTemp,
    };
  }

  // Calculate derived wind values (true wind, wind chill, heat index, etc.)
  calculateDerivedWindValues(
    apparentWindData: ApparentWindData
  ): DerivedWindValues {
    const timestamp = new Date().toISOString();
    const source = this.getVesselBasedSource('derived');

    const effectiveHeadingTrueRad = this.anchorSet
      ? this.anchorApparentBearing
      : this.headingTrue;
    const effectiveHeadingMagneticRad = this.anchorSet
      ? this.anchorApparentBearing
      : this.headingMagnetic;

    // Compute the apparent wind angle relative to the boat
    const angleApparent = this.normalizeAngle(
      apparentWindData.windAngleRelativeRad ||
        apparentWindData.apparentTrueRad - effectiveHeadingTrueRad
    );

    // True Wind Calculation in the True Frame
    const effectiveSOG = this.anchorSet ? 0 : this.speedOverGround;

    const Vx = effectiveSOG * Math.cos(effectiveHeadingTrueRad);
    const Vy = effectiveSOG * Math.sin(effectiveHeadingTrueRad);
    const Ax =
      apparentWindData.windSpeed * Math.cos(apparentWindData.apparentTrueRad);
    const Ay =
      apparentWindData.windSpeed * Math.sin(apparentWindData.apparentTrueRad);
    const Wx = Ax + Vx;
    const Wy = Ay + Vy;
    const trueWindSpeed = Math.sqrt(Wx * Wx + Wy * Wy);

    const rawTrueDirection = Math.atan2(Wy, Wx);
    const trueWindDirTrueRad = this.toCompassBearing(rawTrueDirection);
    const angleTrueGround = this.normalizeAngle(
      trueWindDirTrueRad - effectiveHeadingTrueRad
    );

    // True Wind Calculation in the Magnetic Frame
    const VxMag = effectiveSOG * Math.cos(effectiveHeadingMagneticRad);
    const VyMag = effectiveSOG * Math.sin(effectiveHeadingMagneticRad);
    const AxMag =
      apparentWindData.windSpeed *
      Math.cos(apparentWindData.apparentMagneticRad);
    const AyMag =
      apparentWindData.windSpeed *
      Math.sin(apparentWindData.apparentMagneticRad);
    const WxMag = AxMag + VxMag;
    const WyMag = AyMag + VyMag;

    const rawMagneticDirection = Math.atan2(WyMag, WxMag);
    const trueWindDirMagRad = this.toCompassBearing(rawMagneticDirection);
    const angleTrueWater = this.normalizeAngle(
      trueWindDirMagRad - effectiveHeadingMagneticRad
    );

    // Wind Chill Calculation (K)
    const airTempC = this.airTemp;
    const windSpeedKmh = trueWindSpeed * 3.6;
    let windChillK: number | null = null;

    if (airTempC <= 10 && windSpeedKmh > 4.8) {
      const windChillC =
        13.12 +
        0.6215 * airTempC -
        11.37 * Math.pow(windSpeedKmh, 0.16) +
        0.3965 * airTempC * Math.pow(windSpeedKmh, 0.16);
      windChillK = windChillC + 273.15;
    }

    // Heat Index Calculation (K)
    const airTempF = (airTempC * 9) / 5 + 32;
    let heatIndexK: number | null = null;

    if (airTempF >= 80 && this.humidity >= 40) {
      const T = airTempF;
      const R = this.humidity;
      const heatIndexF =
        -42.379 +
        2.04901523 * T +
        10.14333127 * R -
        0.22475541 * T * R -
        0.00683783 * T * T -
        0.05481717 * R * R +
        0.00122874 * T * T * R +
        0.00085282 * T * R * R -
        0.00000199 * T * T * R * R;
      const heatIndexC = ((heatIndexF - 32) * 5) / 9;
      heatIndexK = heatIndexC + 273.15;
    }

    // Feels Like Calculation (K)
    let feelsLikeK = this.airTemp;
    if (windChillK !== null && airTempC <= 10) {
      feelsLikeK = windChillK;
    } else if (heatIndexK !== null && airTempC >= 27) {
      feelsLikeK = heatIndexK;
    }

    return {
      speedApparent: apparentWindData.windSpeed,
      angleApparent,
      angleTrueGround,
      angleTrueWater,
      directionTrue: trueWindDirTrueRad,
      directionMagnetic: trueWindDirMagRad,
      speedTrue: trueWindSpeed,
      windChill: windChillK,
      heatIndex: heatIndexK,
      feelsLike: feelsLikeK,
      timestamp,
      source,
    };
  }

  // Create SignalK deltas for all wind calculations
  createWindDeltas(derivedValues: DerivedWindValues): SignalKDelta[] {
    const deltas: SignalKDelta[] = [];
    const windPaths: Record<
      keyof Pick<
        DerivedWindValues,
        | 'speedApparent'
        | 'angleApparent'
        | 'angleTrueGround'
        | 'angleTrueWater'
        | 'directionTrue'
        | 'directionMagnetic'
        | 'speedTrue'
      >,
      string
    > = {
      speedApparent: 'environment.wind.speedApparent',
      angleApparent: 'environment.wind.angleApparent',
      angleTrueGround: 'environment.wind.angleTrueGround',
      angleTrueWater: 'environment.wind.angleTrueWater',
      directionTrue: 'environment.wind.directionTrue',
      directionMagnetic: 'environment.wind.directionMagnetic',
      speedTrue: 'environment.wind.speedTrue',
    };

    const tempestPaths: Record<
      keyof Pick<DerivedWindValues, 'windChill' | 'heatIndex' | 'feelsLike'>,
      string
    > = {
      windChill: 'environment.outside.tempest.observations.windChill',
      heatIndex: 'environment.outside.tempest.observations.heatIndex',
      feelsLike: 'environment.outside.tempest.observations.feelsLike',
    };

    // Create deltas for wind values
    Object.entries(windPaths).forEach(([key, path]) => {
      const typedKey = key as keyof typeof windPaths;
      if (derivedValues[typedKey] !== undefined) {
        deltas.push({
          context: 'vessels.self',
          updates: [
            {
              $source: derivedValues.source,
              timestamp: derivedValues.timestamp,
              values: [
                {
                  path: path,
                  value: derivedValues[typedKey],
                },
              ],
            },
          ],
        });
      }
    });

    // Create deltas for temperature-related values
    Object.entries(tempestPaths).forEach(([key, path]) => {
      const typedKey = key as keyof typeof tempestPaths;
      if (
        derivedValues[typedKey] !== undefined &&
        derivedValues[typedKey] !== null
      ) {
        deltas.push({
          context: 'vessels.self',
          updates: [
            {
              $source: derivedValues.source,
              timestamp: derivedValues.timestamp,
              values: [
                {
                  path: path,
                  value: derivedValues[typedKey],
                },
              ],
            },
          ],
        });
      }
    });

    return deltas;
  }
}
