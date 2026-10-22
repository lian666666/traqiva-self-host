-- Align existing default collection names with the product name.
-- Preserve user-customized project names and every project's identity/data.
UPDATE projects SET name='Traqiva' WHERE name IN ('My project','My proyect');
