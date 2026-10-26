export function formatLatLon(lat: number, lon: number) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

export function formatMetres(m: number) {
  if (Math.abs(m) >= 100_000) return `${Math.round(m / 1000).toLocaleString()} km`;
  return `${Math.round(m).toLocaleString()} m`;
}
