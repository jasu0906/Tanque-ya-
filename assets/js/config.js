/*
 * Tanque ya: configuración.
 * Déjalo vacío para usar el modo demostración (todo en el navegador).
 * Para datos y pagos reales, pega aquí los datos de tu proyecto de Supabase
 * (Project Settings → API). La "anon public key" está hecha para ir en la
 * página: la seguridad la ponen las reglas de supabase/schema.sql.
 */
window.TY_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  // Comisión de Tanque ya por pago, que se le factura a la estación (0.01 = 1 %).
  // Debe coincidir con la de supabase/schema.sql (función prepare_payment).
  fee: 0.01
};
