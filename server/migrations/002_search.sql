-- Full-text search over title, author, and category.
-- Title outranks author, and author outranks category, so a title hit sorts first.

ALTER TABLE books ADD COLUMN search_vector tsvector;

UPDATE books AS b
SET search_vector =
  setweight(to_tsvector('english', coalesce(b.title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(b.author, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(c.name, '')), 'C')
FROM categories AS c
WHERE c.id = b.category_id;

ALTER TABLE books ALTER COLUMN search_vector SET NOT NULL;

CREATE INDEX books_search_gin ON books USING GIN (search_vector);

CREATE FUNCTION books_refresh_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  category_name text;
BEGIN
  SELECT name INTO category_name FROM categories WHERE id = NEW.category_id;
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.author, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category_name, '')), 'C');
  RETURN NEW;
END;
$$;

CREATE TRIGGER books_search_vector_trg
BEFORE INSERT OR UPDATE OF title, author, category_id
ON books
FOR EACH ROW
EXECUTE FUNCTION books_refresh_search_vector();

CREATE FUNCTION categories_refresh_books() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE books AS b
    SET search_vector =
      setweight(to_tsvector('english', coalesce(b.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(b.author, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.name, '')), 'C')
    WHERE b.category_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER categories_refresh_books_trg
AFTER UPDATE OF name ON categories
FOR EACH ROW
EXECUTE FUNCTION categories_refresh_books();
