import { db } from './schema';
import type { Tag, EntityTag, EntityType } from '../../types';

export async function putTag(tag: Tag): Promise<void> {
  await db.tags.put(tag);
}

export async function getTag(id: string): Promise<Tag | undefined> {
  return db.tags.get(id);
}

export async function getTagByName(name: string): Promise<Tag | undefined> {
  return db.tags.where('name').equals(name).first();
}

export async function listTags(query?: string, category?: EntityType | string): Promise<Tag[]> {
  let collection = db.tags.toCollection();
  if (category) {
    collection = collection.filter((t) => t.category === category);
  }
  if (query) {
    const needle = query.toLowerCase();
    collection = collection.filter((t) => t.name.toLowerCase().includes(needle));
  }
  return collection.sortBy('name');
}

export async function updateTag(
  id: string,
  updates: Partial<Pick<Tag, 'name' | 'color' | 'category'>>
): Promise<Tag | undefined> {
  await db.tags.update(id, updates);
  return db.tags.get(id);
}

export async function deleteTag(id: string): Promise<void> {
  await db.transaction('rw', db.tags, db.entityTags, async () => {
    await db.tags.delete(id);
    await db.entityTags.where('tagId').equals(id).delete();
  });
}

export async function tagEntity(
  tagId: string,
  entityId: string,
  entityType: EntityType,
  id: string = crypto.randomUUID()
): Promise<EntityTag> {
  const existing = await db.entityTags
    .where('[tagId+entityId+entityType]')
    .equals([tagId, entityId, entityType])
    .first();
  if (existing) return existing;

  const row: EntityTag = { id, tagId, entityId, entityType, createdAt: new Date() };
  await db.transaction('rw', db.entityTags, db.tags, async () => {
    await db.entityTags.put(row);
    const tag = await db.tags.get(tagId);
    if (tag) {
      await db.tags.update(tagId, { usageCount: tag.usageCount + 1 });
    }
  });
  return row;
}

export async function untagEntity(
  tagId: string,
  entityId: string,
  entityType: EntityType
): Promise<void> {
  await db.transaction('rw', db.entityTags, db.tags, async () => {
    const deleted = await db.entityTags
      .where('[tagId+entityId+entityType]')
      .equals([tagId, entityId, entityType])
      .delete();
    if (deleted > 0) {
      const tag = await db.tags.get(tagId);
      if (tag && tag.usageCount > 0) {
        await db.tags.update(tagId, { usageCount: tag.usageCount - 1 });
      }
    }
  });
}

export async function getEntityTags(
  entityType: EntityType,
  entityId: string
): Promise<Tag[]> {
  const links = await db.entityTags
    .where('[entityType+entityId]')
    .equals([entityType, entityId])
    .toArray();
  if (links.length === 0) return [];
  const tagIds = links.map((l) => l.tagId);
  const tags = await db.tags.bulkGet(tagIds);
  return tags.filter((t): t is Tag => Boolean(t));
}

export async function getEntityIdsForTag(
  tagId: string,
  entityType: EntityType
): Promise<string[]> {
  const links = await db.entityTags
    .where('tagId')
    .equals(tagId)
    .filter((l) => l.entityType === entityType)
    .toArray();
  return links.map((l) => l.entityId);
}
