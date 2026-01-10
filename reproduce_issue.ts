
async function run() {
  const API_BASE = 'http://localhost:8787';

  // 1. Get all relationships to find one to delete (e.g., Dad -> Mom)
  const res = await fetch(`${API_BASE}/api/relationships`);
  const relationships = await res.json();
  
  // Find a spouse relationship
  const rel = relationships.find((r: any) => r.type === 'spouse');
  
  if (!rel) {
    console.log('No spouse relationship found to test with.');
    return;
  }

  console.log(`Found relationship to delete: ${rel.id} (${rel.from_person_id} -> ${rel.to_person_id})`);

  // 2. Delete it
  const delRes = await fetch(`${API_BASE}/api/relationships/${rel.id}`, {
    method: 'DELETE'
  });
  
  if (!delRes.ok) {
    console.error('Failed to delete relationship:', await delRes.text());
    return;
  }
  console.log('Deleted relationship successfully.');

  // 3. Try to create a new relationship (Mom -> Dad)
  // Note: we are reversing the direction here just to match the user's description roughly
  // "mom right dot to dad left dot" could be either direction depending on who they clicked first.
  // Assuming they clicked Mom first (Source) -> Dad (Target).
  
  const fromId = rel.to_person_id;
  const toId = rel.from_person_id;

  console.log(`Attempting to create relationship: ${fromId} -> ${toId}`);

  const createRes = await fetch(`${API_BASE}/api/relationships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_person_id: fromId,
      to_person_id: toId,
      type: 'parent_child', // Default type
      metadata: { sourceHandle: 'right-s', targetHandle: 'left-t' }
    })
  });

  if (!createRes.ok) {
    console.error('Failed to create relationship:', await createRes.text());
  } else {
    console.log('Created relationship successfully:', await createRes.json());
  }
}

run();
