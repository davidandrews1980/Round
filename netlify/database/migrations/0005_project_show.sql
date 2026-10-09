alter table seats add column if not exists job text not null default '';
alter table seats add column if not exists personality text not null default '';
alter table tables add column if not exists plan text not null default '';
alter table tables add column if not exists scene text not null default '';

update seats set job = instruction where job = '' and instruction <> '';

create table if not exists scenes (
  table_id integer not null references tables(id) on delete cascade,
  user_id text not null,
  round integer not null,
  direction text not null,
  primary key (table_id, round)
);
