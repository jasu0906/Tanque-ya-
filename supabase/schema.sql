-- =====================================================================
-- Tanque ya · base de datos (Supabase / Postgres)
-- Pagos con Pago Móvil directo a la estación, confirmados por el gerente.
--
-- Cómo usarlo: en Supabase, abre SQL Editor, pega este archivo y pulsa Run.
-- Se puede ejecutar varias veces: no borra datos.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Estaciones activadas en Tanque ya (las demás salen de OpenStreetMap)
-- ---------------------------------------------------------------------
create table if not exists public.stations (
  id          text primary key,                 -- mismo id que en el mapa, p. ej. 'osm-n123456'
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  address     text not null default '',
  city        text not null default '',
  open        boolean not null default true,
  hours       text not null default '',
  queue       text check (queue in ('none', 'short', 'long', 'empty')),
  accepts_app boolean not null default false,
  modality    text not null default 'intl' check (modality in ('intl', 'subs')),
  rate        numeric(14, 4) not null default 0 check (rate >= 0),      -- Bs por USD
  fuels       jsonb not null default '{}'::jsonb,                      -- {"g91":{"status":"ok","price":0.5},...}
  pm_bank     text not null default '',          -- código del banco, p. ej. '0102'
  pm_phone    text not null default '',          -- teléfono afiliado a Pago Móvil
  pm_doc      text not null default '',          -- RIF o cédula del titular
  pm_holder   text not null default '',          -- nombre del titular
  updated_at  timestamptz not null default now()
);
-- Última vez que el gerente avisó de que llegó combustible (la gandola).
alter table public.stations add column if not exists restocked_at timestamptz;

create table if not exists public.station_managers (
  user_id    uuid not null references auth.users (id) on delete cascade,
  station_id text not null references public.stations (id) on delete cascade,
  primary key (user_id, station_id)
);

-- Solicitudes de gerentes que quieren activar su estación.
create table if not exists public.station_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  station_id  text not null,
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  address     text not null default '',
  city        text not null default '',
  contact     text not null default '',
  rif         text not null default '',
  status      text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada')),
  created_at  timestamptz not null default now()
);

-- Reportes de cola de los conductores (sirven para cualquier estación del mapa).
create table if not exists public.queue_reports (
  id          bigint generated always as identity primary key,
  station_id  text not null,
  status      text not null check (status in ('none', 'short', 'long', 'empty')),
  reporter    uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists queue_reports_recent on public.queue_reports (station_id, created_at desc);

-- Pagos.
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  station_id    text not null references public.stations (id),
  station_name  text not null default '',
  driver_id     uuid not null default auth.uid(),
  fuel          text not null check (fuel in ('g91', 'g95', 'diesel')),
  liters        numeric(8, 2) not null check (liters > 0 and liters <= 500),
  price_usd     numeric(10, 4) not null default 0,
  rate          numeric(14, 4) not null default 0,
  total_usd     numeric(12, 2) not null default 0,
  total_bs      numeric(14, 2) not null default 0,
  fee_usd       numeric(10, 2) not null default 0,   -- comisión de Tanque ya, se le factura a la estación
  payer_bank    text not null,
  payer_phone   text not null check (payer_phone ~ '^[0-9]{11}$'),
  payer_doc     text not null check (payer_doc ~ '^[VEJPG]-?[0-9]{5,10}$'),
  reference     text not null check (reference ~ '^[0-9]{4,20}$'),
  status        text not null default 'por_verificar'
                check (status in ('por_verificar', 'aprobado', 'rechazado', 'despachado')),
  reject_reason text,
  created_at    timestamptz not null default now(),
  verified_at   timestamptz,
  dispatched_at timestamptz,
  unique (station_id, reference)   -- una referencia no se puede usar dos veces en la misma estación
);
-- Placa del vehículo (opcional): sirve al conductor o a la flota para llevar su control de gasto.
alter table public.payments add column if not exists vehicle text not null default '';
do $$ begin
  alter table public.payments add constraint payments_vehicle_len check (char_length(vehicle) <= 10);
exception when duplicate_object then null; end $$;
create index if not exists payments_station on public.payments (station_id, created_at desc);
create index if not exists payments_driver on public.payments (driver_id, created_at desc);

-- ---------------------------------------------------------------------
-- Funciones y disparadores
-- ---------------------------------------------------------------------
create or replace function public.is_manager(sid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.station_managers m where m.user_id = auth.uid() and m.station_id = sid);
$$;

create or replace function public.touch_station()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.id is distinct from old.id then raise exception 'No se puede cambiar el id de la estación'; end if;
  return new;
end $$;
drop trigger if exists stations_touch on public.stations;
create trigger stations_touch before update on public.stations for each row execute function public.touch_station();

-- Al crear un pago, el precio, la tasa y el total los pone el servidor
-- a partir de la estación, no el teléfono del conductor.
create or replace function public.prepare_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.stations;
  f jsonb;
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  select * into st from public.stations where id = new.station_id;
  if not found then raise exception 'La estación no existe en Tanque ya'; end if;
  if not st.accepts_app or not st.open then raise exception 'La estación no está aceptando pagos ahora'; end if;
  if st.pm_bank = '' or st.pm_phone = '' or st.pm_doc = '' then raise exception 'La estación no tiene sus datos de Pago Móvil'; end if;
  if st.rate <= 0 then raise exception 'La estación no tiene la tasa del día'; end if;
  if st.updated_at < now() - interval '24 hours' then raise exception 'La estación no ha actualizado sus datos hoy'; end if;
  f := st.fuels -> new.fuel;
  if f is null or (f ->> 'status') not in ('ok', 'low') or coalesce((f ->> 'price')::numeric, 0) <= 0 then
    raise exception 'Ese combustible no está disponible';
  end if;

  new.driver_id     := auth.uid();
  if new.driver_id is null then raise exception 'Sesión requerida'; end if;
  new.station_name  := st.name;
  new.price_usd     := (f ->> 'price')::numeric;
  new.rate          := st.rate;
  new.total_usd     := round(new.liters * new.price_usd, 2);
  new.total_bs      := round(new.liters * new.price_usd * st.rate, 2);
  new.fee_usd       := round(new.total_usd * 0.01, 2);
  new.status        := 'por_verificar';
  new.vehicle       := upper(regexp_replace(coalesce(new.vehicle, ''), '[^A-Za-z0-9]', '', 'g'));
  new.reject_reason := null;
  new.verified_at   := null;
  new.dispatched_at := null;
  new.created_at    := now();
  loop
    c := 'TY-';
    for i in 1..6 loop
      c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1);
      if i = 3 then c := c || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.payments where code = c);
  end loop;
  new.code := c;
  return new;
end $$;
drop trigger if exists payments_prepare on public.payments;
create trigger payments_prepare before insert on public.payments for each row execute function public.prepare_payment();

-- El gerente solo puede cambiar el estado, y solo en el orden correcto.
create or replace function public.guard_payment()
returns trigger language plpgsql as $$
begin
  if (new.id, new.code, new.station_id, new.station_name, new.driver_id, new.fuel, new.liters, new.price_usd, new.rate,
      new.total_usd, new.total_bs, new.fee_usd, new.payer_bank, new.payer_phone, new.payer_doc, new.reference, new.vehicle, new.created_at)
     is distinct from
     (old.id, old.code, old.station_id, old.station_name, old.driver_id, old.fuel, old.liters, old.price_usd, old.rate,
      old.total_usd, old.total_bs, old.fee_usd, old.payer_bank, old.payer_phone, old.payer_doc, old.reference, old.vehicle, old.created_at) then
    raise exception 'Solo se puede cambiar el estado del pago';
  end if;
  if new.status = old.status then return new; end if;
  if old.status = 'por_verificar' and new.status in ('aprobado', 'rechazado') then
    new.verified_at := now();
    if new.status = 'aprobado' then new.reject_reason := null; end if;
  elsif old.status = 'aprobado' and new.status = 'despachado' then
    new.dispatched_at := now();
  else
    raise exception 'Cambio de estado no permitido: % → %', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists payments_guard on public.payments;
create trigger payments_guard before update on public.payments for each row execute function public.guard_payment();

-- Un reporte de cola por conductor y estación cada 5 minutos.
create or replace function public.limit_reports()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.reporter := auth.uid();
  new.created_at := now();
  if exists (select 1 from public.queue_reports r
             where r.reporter = new.reporter and r.station_id = new.station_id
               and r.created_at > now() - interval '5 minutes') then
    raise exception 'Ya reportaste esta estación hace poco';
  end if;
  return new;
end $$;
drop trigger if exists queue_reports_limit on public.queue_reports;
create trigger queue_reports_limit before insert on public.queue_reports for each row execute function public.limit_reports();

-- Para el administrador (SQL Editor): activa una solicitud y vincula al gerente.
create or replace function public.approve_station_request(req_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r public.station_requests;
begin
  select * into r from public.station_requests where id = req_id;
  if not found then raise exception 'No existe la solicitud %', req_id; end if;
  insert into public.stations (id, name, lat, lng, address, city, pm_doc)
  values (r.station_id, r.name, r.lat, r.lng, r.address, r.city, r.rif)
  on conflict (id) do nothing;
  insert into public.station_managers (user_id, station_id) values (r.user_id, r.station_id)
  on conflict do nothing;
  update public.station_requests set status = 'aprobada' where id = req_id;
  return r.station_id;
end $$;
revoke all on function public.approve_station_request(bigint) from public;
revoke all on function public.approve_station_request(bigint) from anon, authenticated;

-- ---------------------------------------------------------------------
-- Seguridad por filas (RLS)
-- ---------------------------------------------------------------------
alter table public.stations          enable row level security;
alter table public.station_managers  enable row level security;
alter table public.station_requests  enable row level security;
alter table public.queue_reports     enable row level security;
alter table public.payments          enable row level security;

drop policy if exists "estaciones: lectura pública" on public.stations;
create policy "estaciones: lectura pública" on public.stations for select to anon, authenticated using (true);
drop policy if exists "estaciones: el gerente edita la suya" on public.stations;
create policy "estaciones: el gerente edita la suya" on public.stations for update to authenticated
  using (public.is_manager(id)) with check (public.is_manager(id));

drop policy if exists "gerentes: ver mis vínculos" on public.station_managers;
create policy "gerentes: ver mis vínculos" on public.station_managers for select to authenticated using (user_id = auth.uid());

drop policy if exists "solicitudes: crear la mía" on public.station_requests;
create policy "solicitudes: crear la mía" on public.station_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pendiente');
drop policy if exists "solicitudes: ver las mías" on public.station_requests;
create policy "solicitudes: ver las mías" on public.station_requests for select to authenticated using (user_id = auth.uid());

drop policy if exists "cola: lectura pública" on public.queue_reports;
create policy "cola: lectura pública" on public.queue_reports for select to anon, authenticated using (true);
drop policy if exists "cola: reportar" on public.queue_reports;
create policy "cola: reportar" on public.queue_reports for insert to authenticated with check (reporter = auth.uid());

drop policy if exists "pagos: ver los míos o los de mi estación" on public.payments;
create policy "pagos: ver los míos o los de mi estación" on public.payments for select to authenticated
  using (driver_id = auth.uid() or public.is_manager(station_id));
drop policy if exists "pagos: crear" on public.payments;
create policy "pagos: crear" on public.payments for insert to authenticated with check (driver_id = auth.uid());
drop policy if exists "pagos: el gerente cambia el estado" on public.payments;
create policy "pagos: el gerente cambia el estado" on public.payments for update to authenticated
  using (public.is_manager(station_id)) with check (public.is_manager(station_id));

-- Permisos básicos (Supabase ya los da; se repiten por claridad).
grant usage on schema public to anon, authenticated;
grant select on public.stations, public.queue_reports to anon, authenticated;
grant update on public.stations to authenticated;
grant select on public.station_managers to authenticated;
grant select, insert on public.station_requests, public.queue_reports, public.payments to authenticated;
grant update (status, reject_reason) on public.payments to authenticated;
