begin;

alter table public.equipo2_registros
  add column ambiente text,
  add column retirado boolean not null default false,
  add column asignado_a uuid references public.equipo2_integrantes(usuario),
  add column registrado_por uuid references public.equipo2_integrantes(usuario),
  add column registrado_en timestamptz;

create table public.equipo2_precargas (
  renipress text primary key check (renipress ~ '^[0-9]{8}$')
);
alter table public.equipo2_precargas enable row level security;
revoke all on public.equipo2_precargas from public, anon, authenticated;

update public.equipo2_registros
set ambiente = case
      when bloque like 'extra-%' then datos->>'nombre'
      when bloque like 'area-%' then (array[
        'Enfermeria 1', 'Obstetricia', 'Farmacia', 'Triaje', 'Enfermeria 2', 'Emergencia',
        'Adolescente', 'Desarrollo Infantil', 'Oficina Radiologo', 'Lab. Bioquimica',
        'Rayos X', 'Topico', 'Ampliacion', 'Archivo Historias Admision',
        'Consultorio De La Mujer', 'Consultorio Del Niño'
      ])[substring(bloque from 6)::int]
    end,
    datos = case when bloque like 'extra-%' then datos - 'nombre' else datos end,
    asignado_a = case when responsable <> actualizado_por then responsable end;

update public.equipo2_registros set registrado_por = creado_por, registrado_en = creado_en
where datos <> '{}'::jsonb;

create or replace function public.equipo2_guardar(
  p_renipress text, p_bloque text, p_version int, p_datos jsonb, p_responsable uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  autor uuid := auth.uid();
  instante timestamptz := clock_timestamp();
  registro public.equipo2_registros;
  con_datos boolean := p_datos <> '{}'::jsonb;
begin
  if not public.es_integrante_equipo2() then raise insufficient_privilege; end if;
  if p_version is null or p_version < 0 then raise invalid_parameter_value; end if;

  if p_version = 0 then
    if p_bloque not like 'area-%' and p_bloque not like 'extra-%' then
      insert into public.equipo2_registros
        (renipress, bloque, datos, responsable, creado_por, actualizado_por, actualizado_en, registrado_por, registrado_en)
      values (p_renipress, p_bloque, p_datos, autor, autor, autor, instante,
        case when con_datos then autor end, case when con_datos then instante end)
      on conflict (renipress, bloque) do nothing returning * into registro;
    end if;
  else
    update public.equipo2_registros
    set datos = p_datos, responsable = autor, actualizado_por = autor, actualizado_en = instante,
        registrado_por = coalesce(registrado_por, case when con_datos then autor end),
        registrado_en = coalesce(registrado_en, case when con_datos then instante end), version = version + 1
    where renipress = p_renipress and bloque = p_bloque and version = p_version and not retirado
    returning * into registro;
  end if;

  if registro.renipress is not null then return jsonb_build_object('registro', to_jsonb(registro)); end if;
  select * into registro from public.equipo2_registros where renipress = p_renipress and bloque = p_bloque;
  return jsonb_build_object('conflicto', true, 'registro', to_jsonb(registro));
end;
$$;

create function public.equipo2_confirmar_ambientes(
  p_renipress text, p_ambientes jsonb, p_omitir_existentes boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  autor uuid := auth.uid();
  item jsonb;
  nombre text;
  agregados int := 0;
  registro public.equipo2_registros;
begin
  if not public.es_integrante_equipo2() then raise insufficient_privilege; end if;
  if jsonb_typeof(p_ambientes) is distinct from 'array' or jsonb_array_length(p_ambientes) not between 1 and 16
    or (p_omitir_existentes is not true and jsonb_array_length(p_ambientes) <> 1) then
    raise invalid_parameter_value;
  end if;
  -- Serializa solo altas de la misma sede para poder detectar duplicados concurrentes.
  perform pg_advisory_xact_lock(2016, hashtext(p_renipress));
  if p_omitir_existentes and exists (select 1 from public.equipo2_precargas where renipress = p_renipress) then
    return jsonb_build_object('agregados', 0);
  end if;
  for item in select value from jsonb_array_elements(p_ambientes) loop
    nombre := normalize(btrim(regexp_replace(item->>'nombre', '[[:space:]]+', ' ', 'g')), NFC);
    if nombre is null or length(nombre) not between 1 and 120
      or (p_omitir_existentes and (item->>'bloque') not like 'area-%')
      or (p_omitir_existentes is not true and (item->>'bloque') not like 'extra-%') then
      raise invalid_parameter_value;
    end if;
    if exists (select 1 from public.equipo2_registros where renipress = p_renipress and (p_omitir_existentes or not retirado)
      and lower(normalize(btrim(regexp_replace(ambiente, '[[:space:]]+', ' ', 'g')), NFC)) = lower(nombre)) then
      if p_omitir_existentes is not true then return jsonb_build_object('duplicado', true); end if;
    else
      insert into public.equipo2_registros
        (renipress, bloque, datos, responsable, creado_por, actualizado_por, ambiente, creado_en)
      values (p_renipress, item->>'bloque', '{}'::jsonb, autor, autor, autor, nombre, clock_timestamp())
      on conflict (renipress, bloque) do nothing returning * into registro;
      if not found then continue; end if;
      agregados := agregados + 1;
      if p_omitir_existentes is not true then
        return jsonb_build_object('agregados', agregados, 'registro', to_jsonb(registro));
      end if;
    end if;
  end loop;
  if p_omitir_existentes then insert into public.equipo2_precargas values (p_renipress); end if;
  return jsonb_build_object('agregados', agregados);
end;
$$;

create function public.equipo2_organizar(
  p_renipress text, p_bloque text, p_version int, p_retirar boolean, p_asignado uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  autor uuid := auth.uid();
  registro public.equipo2_registros;
  es_ambiente boolean := p_bloque like 'area-%' or p_bloque like 'extra-%';
begin
  if not public.es_integrante_equipo2() then raise insufficient_privilege; end if;
  if p_retirar is null or p_version is null or p_version < 0
    or (p_retirar and (not es_ambiente or p_version = 0 or p_asignado is not null)) then
    raise invalid_parameter_value;
  end if;

  if p_version = 0 then
    if not es_ambiente then
      insert into public.equipo2_registros
        (renipress, bloque, datos, responsable, creado_por, actualizado_por, asignado_a)
      values (p_renipress, p_bloque, '{}'::jsonb, autor, autor, autor, p_asignado)
      on conflict (renipress, bloque) do nothing returning * into registro;
    end if;
  else
    update public.equipo2_registros
    set asignado_a = p_asignado, retirado = p_retirar, version = version + 1
    where renipress = p_renipress and bloque = p_bloque and version = p_version and not retirado
    returning * into registro;
  end if;
  if registro.renipress is not null then return jsonb_build_object('registro', to_jsonb(registro)); end if;
  select * into registro from public.equipo2_registros where renipress = p_renipress and bloque = p_bloque;
  return jsonb_build_object('conflicto', true, 'registro', to_jsonb(registro));
end;
$$;

revoke all on function public.equipo2_confirmar_ambientes(text, jsonb, boolean) from public, anon;
revoke all on function public.equipo2_organizar(text, text, int, boolean, uuid) from public, anon;
grant execute on function public.equipo2_confirmar_ambientes(text, jsonb, boolean) to authenticated;
grant execute on function public.equipo2_organizar(text, text, int, boolean, uuid) to authenticated;

create or replace function public.equipo2_avance() returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(renipress, jsonb_build_object('registrados', registrados, 'ambientes', ambientes)), '{}'::jsonb)
  from (
    select renipress, count(*) filter (where not retirado and datos <> '{}'::jsonb) as registrados,
           count(*) filter (where not retirado and ambiente is not null) as ambientes
    from public.equipo2_registros group by renipress
  ) as avance;
$$;

create or replace function public.equipo2_ficha(p_renipress text) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by creado_en, bloque), '[]'::jsonb)
  from public.equipo2_registros as r where renipress = p_renipress and not retirado;
$$;

commit;
