import requests
response = requests.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": "Bearer test"}, json={"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "hi"}]})
response.raise_for_status()
