alter table tables add column if not exists mode text not null default 'both';
alter table tables add column if not exists user_away boolean not null default false;
alter table tables add column if not exists completed boolean not null default false;

alter table seats add column if not exists job_title text not null default '';
alter table seats add column if not exists caution smallint not null default 50;
alter table seats add column if not exists creativity smallint not null default 50;
alter table seats add column if not exists openness smallint not null default 50;
alter table seats add column if not exists confidence smallint not null default 50;
alter table seats add column if not exists empathy smallint not null default 50;
alter table seats add column if not exists directness smallint not null default 50;

create table if not exists ideas (
  id serial primary key,
  table_id integer not null references tables(id) on delete cascade,
  user_id text not null,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists ideas_table_id_idx on ideas (table_id);

create table if not exists whispers (
  id serial primary key,
  table_id integer not null references tables(id) on delete cascade,
  user_id text not null,
  from_name text not null,
  to_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists whispers_table_id_idx on whispers (table_id);

create table if not exists mcp_servers (
  id serial primary key,
  user_id text not null,
  name text not null,
  url text not null,
  enabled boolean not null default true,
  tools text not null default '[]',
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_servers_user_id_idx on mcp_servers (user_id);
