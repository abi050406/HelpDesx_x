BEGIN;

ALTER TABLE configuracion_categorias
  ADD COLUMN IF NOT EXISTS descripcion TEXT,
  ADD COLUMN IF NOT EXISTS prioridad_baja_min INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prioridad_media_min INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS prioridad_alta_min INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS prioridad_critica_min INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS color VARCHAR(20),
  ADD COLUMN IF NOT EXISTS icono VARCHAR(50);

ALTER TABLE configuracion_categorias
  ALTER COLUMN nombre_categoria TYPE VARCHAR(100),
  ALTER COLUMN tiempo_sla_minutos SET DEFAULT 60;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='configuracion_categorias' AND column_name='activo'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='configuracion_categorias' AND column_name='is_active'
  ) THEN
    ALTER TABLE configuracion_categorias RENAME COLUMN activo TO is_active;
  END IF;
END $$;

ALTER TABLE configuracion_categorias
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='etiquetas_categoria' AND column_name='nombre_etiqueta'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='etiquetas_categoria' AND column_name='nombre'
  ) THEN
    ALTER TABLE etiquetas_categoria RENAME COLUMN nombre_etiqueta TO nombre;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='etiquetas_categoria' AND column_name='activo'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='etiquetas_categoria' AND column_name='is_active'
  ) THEN
    ALTER TABLE etiquetas_categoria RENAME COLUMN activo TO is_active;
  END IF;
END $$;

ALTER TABLE etiquetas_categoria
  ADD COLUMN IF NOT EXISTS descripcion TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS preguntas_contexto (
  id SERIAL PRIMARY KEY,
  categoria_id INTEGER NOT NULL REFERENCES configuracion_categorias(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  legacy_key VARCHAR(80),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opciones_pregunta (
  id SERIAL PRIMARY KEY,
  pregunta_id INTEGER NOT NULL REFERENCES preguntas_contexto(id) ON DELETE CASCADE,
  texto VARCHAR(160) NOT NULL,
  puntaje INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pregunta_categoria_legacy
  ON preguntas_contexto(categoria_id, legacy_key) WHERE legacy_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_etiqueta_categoria_nombre
  ON etiquetas_categoria(categoria_id, nombre);
CREATE INDEX IF NOT EXISTS idx_preguntas_categoria
  ON preguntas_contexto(categoria_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_opciones_pregunta
  ON opciones_pregunta(pregunta_id, is_active, sort_order);

INSERT INTO preguntas_contexto(categoria_id, pregunta, legacy_key, sort_order)
SELECT c.id,
       COALESCE(q.item->>'label', q.item->>'pregunta'),
       q.item->>'id',
       q.ordinality::integer
FROM configuracion_categorias c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.preguntas_contexto, '[]'::jsonb))
  WITH ORDINALITY AS q(item, ordinality)
WHERE COALESCE(q.item->>'label', q.item->>'pregunta') IS NOT NULL
ON CONFLICT (categoria_id, legacy_key) WHERE legacy_key IS NOT NULL DO NOTHING;

INSERT INTO opciones_pregunta(pregunta_id, texto, puntaje, sort_order)
SELECT p.id,
       COALESCE(o.item->>'label', o.item->>'nombre', o.item->>'texto'),
       COALESCE((o.item->>'score')::integer, (o.item->>'puntaje')::integer, 0),
       o.ordinality::integer
FROM configuracion_categorias c
JOIN preguntas_contexto p ON p.categoria_id=c.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.preguntas_contexto, '[]'::jsonb)) q(item)
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q.item->'options', q.item->'opciones', '[]'::jsonb))
  WITH ORDINALITY AS o(item, ordinality)
WHERE p.legacy_key=q.item->>'id'
  AND COALESCE(o.item->>'label', o.item->>'nombre', o.item->>'texto') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM opciones_pregunta existing
    WHERE existing.pregunta_id=p.id
      AND existing.texto=COALESCE(o.item->>'label', o.item->>'nombre', o.item->>'texto')
  );

INSERT INTO configuracion_categorias(nombre_categoria, descripcion, tiempo_sla_minutos, color, icono)
SELECT seed.nombre, seed.descripcion, seed.sla, seed.color, seed.icono
FROM (VALUES
  ('Software', 'Aplicaciones, sistemas y programas', 60, '#6366F1', 'software'),
  ('Hardware', 'Equipos y periféricos', 120, '#F59E0B', 'hardware'),
  ('Redes', 'Conectividad, Internet y VPN', 45, '#0EA5E9', 'network'),
  ('Accesos', 'Cuentas, permisos y credenciales', 60, '#8B5CF6', 'key'),
  ('Otros', 'Solicitudes no clasificadas', 120, '#64748B', 'help')
) AS seed(nombre, descripcion, sla, color, icono)
WHERE NOT EXISTS (SELECT 1 FROM configuracion_categorias)
ON CONFLICT (nombre_categoria) DO NOTHING;

INSERT INTO etiquetas_categoria(categoria_id, nombre, sort_order)
SELECT c.id, tag.nombre, tag.orden
FROM configuracion_categorias c
JOIN (VALUES
  ('Software','Error de acceso',1), ('Software','Aplicación caída',2), ('Software','Instalación',3), ('Software','Rendimiento',4),
  ('Hardware','Equipo no enciende',1), ('Hardware','Impresora',2), ('Hardware','Periférico',3), ('Hardware','Daño físico',4),
  ('Redes','Sin Internet',1), ('Redes','VPN caída',2), ('Redes','Wi-Fi',3), ('Redes','Servidor inaccesible',4),
  ('Accesos','Contraseña',1), ('Accesos','Permisos',2), ('Accesos','Cuenta bloqueada',3),
  ('Otros','Consulta general',1), ('Otros','Solicitud de soporte',2)
) AS tag(categoria, nombre, orden) ON tag.categoria=c.nombre_categoria
ON CONFLICT (categoria_id, nombre) DO NOTHING;

INSERT INTO preguntas_contexto(categoria_id, pregunta, legacy_key, sort_order)
SELECT c.id, '¿A cuántas personas afecta?', 'scope', 1
FROM configuracion_categorias c
WHERE NOT EXISTS (SELECT 1 FROM preguntas_contexto p WHERE p.categoria_id=c.id)
ON CONFLICT (categoria_id, legacy_key) WHERE legacy_key IS NOT NULL DO NOTHING;

INSERT INTO opciones_pregunta(pregunta_id, texto, puntaje, sort_order)
SELECT p.id, option.texto, option.puntaje, option.orden
FROM preguntas_contexto p
CROSS JOIN (VALUES ('Solo a mí',0,1), ('A un equipo',2,2), ('A toda la empresa',4,3))
  AS option(texto,puntaje,orden)
WHERE p.legacy_key='scope'
  AND NOT EXISTS (SELECT 1 FROM opciones_pregunta o WHERE o.pregunta_id=p.id);

COMMIT;
