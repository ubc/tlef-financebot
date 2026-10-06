# Run only inside the local Canvas development container. Fixture namespace is financebot-demo.
require 'json'
account = Account.default
key = DeveloperKey.find_by(name: 'FinanceBot local integration') || DeveloperKey.new(name: 'FinanceBot local integration')
key.account = account
key.redirect_uris = ['http://localhost:6118/api/canvas/callback']
key.scopes = ['url:GET|/api/v1/courses', 'url:GET|/api/v1/courses/:course_id/users', 'url:GET|/api/v1/courses/:course_id/sections', 'url:GET|/api/v1/courses/:course_id/files', 'url:GET|/api/v1/courses/:course_id/files/:id', 'url:GET|/api/v1/files/:id/public_url']
key.require_scopes = true
key.save!
binding = DeveloperKeyAccountBinding.find_or_initialize_by(account: account, developer_key: key)
binding.workflow_state = 'on'
binding.save!
# Output is captured directly into ignored .env by the runner; never print this JSON to logs.
puts 'FINANCEBOT_CONFIG=' + {client_id: key.id.to_s, client_secret: key.api_key}.to_json
