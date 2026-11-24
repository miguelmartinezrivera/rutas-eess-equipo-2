create table public.equipo2_integrantes (
  usuario uuid primary key references auth.users(id),
  nombre text not null check (btrim(nombre) <> '')
);

create table public.equipo2_registros (
  renipress text not null check (renipress ~ '^[0-9]{8}$'),
  bloque text not null check (bloque ~ '^(area-(0[1-9]|1[0-6])|extra-[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}|generales|red|electricidad|conformidad|plano|fotos)$'),
  datos jsonb not null check (jsonb_typeof(datos) = 'object'),
  responsable uuid not null references public.equipo2_integrantes(usuario),
  creado_por uuid not null references public.equipo2_integrantes(usuario),
  creado_en timestamptz not null default now(),
  actualizado_por uuid not null references public.equipo2_integrantes(usuario),
  actualizado_en timestamptz not null default now(),
  version int not null default 1,
  primary key (renipress, bloque)
);

alter table public.equipo2_integrantes enable row level security;
alter table public.equipo2_registros enable row level security;
revoke all on public.equipo2_integrantes, public.equipo2_registros from public, anon, authenticated;
grant select on public.equipo2_integrantes, public.equipo2_registros to authenticated;

create function public.es_integrante_equipo2() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.equipo2_integrantes where usuario = auth.uid());
$$;
revoke all on function public.es_integrante_equipo2() from public, anon;
grant execute on function public.es_integrante_equipo2() to authenticated;

create policy equipo2_lee_integrantes on public.equipo2_integrantes for select
to authenticated using ((select public.es_integrante_equipo2()));
create policy equipo2_lee_registros on public.equipo2_registros for select
to authenticated using ((select public.es_integrante_equipo2()));

create or replace function public.equipo2_guardar(
  p_renipress text, p_bloque text, p_version int, p_datos jsonb, p_responsable uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  autor uuid := auth.uid();
  registro public.equipo2_registros;
begin
  if not public.es_integrante_equipo2() then
    raise insufficient_privilege;
  end if;
  if p_version is null or p_version < 0 or
    (p_bloque like 'extra-%' and coalesce(btrim(p_datos->>'nombre'), '') = '') then
    raise invalid_parameter_value;
  end if;

  if p_version = 0 then
    insert into public.equipo2_registros
      (renipress, bloque, datos, responsable, creado_por, actualizado_por)
    values (p_renipress, p_bloque, p_datos, autor, autor, autor)
    on conflict (renipress, bloque) do nothing
    returning * into registro;
  else
    update public.equipo2_registros
    set datos = p_datos, responsable = autor, actualizado_por = autor,
        actualizado_en = clock_timestamp(), version = version + 1
    where renipress = p_renipress and bloque = p_bloque and version = p_version
    returning * into registro;
  end if;

  if found then
    return jsonb_build_object('registro', to_jsonb(registro));
  end if;

  select * into registro from public.equipo2_registros
  where renipress = p_renipress and bloque = p_bloque;
  return jsonb_build_object('conflicto', true, 'registro', to_jsonb(registro));
end;
$$;
revoke all on function public.equipo2_guardar(text, text, int, jsonb, uuid) from public, anon;
grant execute on function public.equipo2_guardar(text, text, int, jsonb, uuid) to authenticated;

create function public.equipo2_avance() returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(renipress, jsonb_build_object('registrados', registrados, 'extras', extras)), '{}'::jsonb)
  from (
    select renipress, count(*) filter (where
             (case when bloque like 'extra-%' then datos - 'nombre' else datos end) <> '{}'::jsonb
           ) as registrados,
           count(*) filter (where bloque like 'extra-%') as extras
    from public.equipo2_registros group by renipress
  ) as avance;
$$;
revoke all on function public.equipo2_avance() from public, anon;
grant execute on function public.equipo2_avance() to authenticated;

create function public.equipo2_ficha(p_renipress text) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by creado_en, bloque), '[]'::jsonb)
  from public.equipo2_registros as r where renipress = p_renipress;
$$;
revoke all on function public.equipo2_ficha(text) from public, anon;
grant execute on function public.equipo2_ficha(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('equipo2-plantillas', 'equipo2-plantillas', false, null, null),
  ('equipo2-adjuntos', 'equipo2-adjuntos', false, 375000, array['image/jpeg']);
create policy equipo2_lee_archivos on storage.objects for select to authenticated
using (bucket_id in ('equipo2-plantillas', 'equipo2-adjuntos')
       and (select public.es_integrante_equipo2()));
create policy equipo2_agrega_adjuntos on storage.objects for insert to authenticated
with check (bucket_id = 'equipo2-adjuntos' and (select public.es_integrante_equipo2()));
