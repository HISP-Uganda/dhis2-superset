export class MapStateManager {
  private center: [number, number] | null = null;
  private zoom: number | null = null;
  private hasInitialFit = false;

  saveState(map: { getCenter: () => { lng: number; lat: number }; getZoom: () => number }): void {
    const c = map.getCenter();
    this.center = [c.lng, c.lat];
    this.zoom = map.getZoom();
  }

  getCenter(): [number, number] | null {
    return this.center;
  }

  getZoom(): number | null {
    return this.zoom;
  }

  markInitialFitDone(): void {
    this.hasInitialFit = true;
  }

  needsInitialFit(): boolean {
    return !this.hasInitialFit;
  }

  reset(): void {
    this.center = null;
    this.zoom = null;
    this.hasInitialFit = false;
  }
}
