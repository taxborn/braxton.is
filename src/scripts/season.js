// Picks the evergarden variant for the visitor's local date and sets it on <html>.
// Runs inline in <head> (see Layout.astro) so the right theme paints on first frame.
(() => {
  // Flip to false to get southern-hemisphere seasons.
  const NORTHERN_HEMISPHERE = true;

  // Meeus, "Astronomical Algorithms" ch. 27: instant of each equinox/solstice.
  const MEAN = [
    [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057], // March equinox
    [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003], // June solstice
    [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078], // September equinox
    [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032], // December solstice
  ];
  const TERMS = [
    [485, 324.96, 1934.136],
    [203, 337.23, 32964.467],
    [199, 342.08, 20.186],
    [182, 27.85, 445267.112],
    [156, 73.14, 45036.886],
    [136, 171.52, 22518.443],
    [77, 222.54, 65928.934],
    [74, 296.72, 3034.906],
    [70, 243.58, 9037.513],
    [58, 119.81, 33718.147],
    [52, 297.17, 150.678],
    [50, 21.02, 2281.226],
    [45, 247.54, 29929.562],
    [44, 325.15, 31555.956],
    [29, 60.93, 4443.417],
    [18, 155.12, 67555.328],
    [17, 288.79, 4562.452],
    [16, 198.04, 62894.029],
    [14, 199.76, 31436.921],
    [12, 95.39, 14577.848],
    [12, 287.11, 31931.757],
    [12, 320.81, 34777.259],
    [9, 227.73, 1222.114],
    [8, 15.45, 16859.074],
  ];
  const rad = (deg) => (deg * Math.PI) / 180;

  const seasonStart = (year, i) => {
    const y = (year - 2000) / 1000;
    const [a, b, c, d, e] = MEAN[i];
    const jde0 = a + y * (b + y * (c + y * (d + y * e)));
    const t = (jde0 - 2451545) / 36525;
    const w = 35999.373 * t - 2.47;
    const dl = 1 + 0.0334 * Math.cos(rad(w)) + 0.0007 * Math.cos(rad(2 * w));
    const s = TERMS.reduce(
      (sum, [A, B, C]) => sum + A * Math.cos(rad(B + C * t)),
      0,
    );
    const jde = jde0 + (0.00001 * s) / dl;
    return new Date((jde - 2440587.5) * 86400000);
  };

  const NORTH = ["spring", "summer", "fall", "winter"];
  const SOUTH = ["fall", "winter", "spring", "summer"];

  const seasonAt = (now, north = NORTHERN_HEMISPHERE) => {
    const names = north ? NORTH : SOUTH;
    const year = now.getUTCFullYear();
    // Before the March equinox we're still in the previous year's December season.
    if (now < seasonStart(year, 0)) return names[3];
    for (let i = 3; i >= 0; i--) {
      if (now >= seasonStart(year, i)) return names[i];
    }
    return names[3];
  };

  if (typeof document !== "undefined") {
    document.documentElement.dataset.season = seasonAt(new Date());
  }
  return seasonAt;
})();
