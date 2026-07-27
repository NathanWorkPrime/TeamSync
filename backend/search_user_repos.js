require('dotenv').config();
const pat = process.env.GITHUB_PAT;

fetch('https://api.github.com/search/repositories?q=user:NathanWorkPrime', {
  headers: {
    'Authorization': `token ${pat}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TeamSync-App'
  }
})
.then(res => res.json())
.then(data => {
  console.log("Search result keys:", Object.keys(data));
  console.log("Total count:", data.total_count);
  if (data.items) {
    data.items.forEach(item => {
      console.log(`- ${item.full_name} (${item.private ? 'private' : 'public'})`);
    });
  } else {
    console.log("No items, data:", JSON.stringify(data));
  }
})
.catch(err => console.error(err));
