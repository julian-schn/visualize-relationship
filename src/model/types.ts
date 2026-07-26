export type Confidence = "certain" | "probable" | "uncertain";
export type PersonStatus = "living" | "deceased" | "unknown" | "merged";
export type Sex = "f" | "m" | "x" | "unknown";
export type Author = "human" | "agent";

export interface FormerName {
  display: string;
  until?: string | null;
}

export interface Names {
  display: string;
  given?: string;
  family?: string;
  nicknames?: string[];
  aka?: string[];
  former?: FormerName[];
}

export interface LifeEvent {
  date?: string | null;
  place?: string | null;
}

export interface ParentEdge {
  id: string;
  kind: string;
  confidence?: Confidence;
}

export interface Meta {
  created: string;
  updated: string;
  author: Author;
}

export interface Person {
  id: string;
  names: Names;
  pronouns?: string[];
  sex?: Sex;
  birth?: LifeEvent;
  death?: LifeEvent;
  status: PersonStatus;
  mergedInto?: string;
  parents?: ParentEdge[];
  tags?: string[];
  links?: Record<string, string>;
  notes?: string;
  meta: Meta;
}

export interface Union {
  id: string;
  partners: string[];
  type: string;
  from?: string | null;
  to?: string | null;
  endReason?: string | null;
  note?: string;
}

export interface Relation {
  id: string;
  type: string;
  from: string;
  to: string;
  symmetric: boolean;
  closeness?: number;
  since?: string | null;
  until?: string | null;
  status: string;
  context?: string[];
  note?: string;
}

export interface VocabEntry {
  key: string;
  label: string;
  provisional?: boolean;
  added?: string;
}

export interface RelationTypeEntry extends VocabEntry {
  symmetric: boolean;
  inverse?: string;
}

export interface Vocab {
  version: number;
  relationType: RelationTypeEntry[];
  parentKind: VocabEntry[];
  unionType: VocabEntry[];
  unionEnd: VocabEntry[];
  relationStatus: VocabEntry[];
  context: VocabEntry[];
  tag: VocabEntry[];
}
