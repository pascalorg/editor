require 'yaml'
require 'open3'

Dir.chdir(File.expand_path('..', __dir__)) do
  workflow = YAML.load_file('.github/workflows/docker.yml')
  steps = workflow.fetch('jobs').fetch('image').fetch('steps')
  validation = steps.find { |step| step['name'] == 'Validate version' }.fetch('run')
  {
    '1.0.0' => true,
    '1.0.0-beta.5' => true,
    'main' => false,
    '../main' => false,
    '1.0.0;echo bad' => false,
    '' => false,
    "1.0.0-#{'a' * 128}" => false
  }.each do |version, expected|
    _, status = Open3.capture2e({'VERSION' => version}, 'bash', '-e', '-c', validation)
    raise "Incorrect version validation: #{version}" unless status.success? == expected
  end

  build = steps.find { |step| step['uses'] == 'docker/build-push-action@v6' }.fetch('with')
  raise 'Missing architecture' unless build['platforms'] == 'linux/amd64,linux/arm64'
  raise 'Publication must be opt-in' unless build['push'] == '${{ inputs.publish }}'
  raise 'Do not promote latest during bootstrap' if build['tags'].include?('latest')
  checkout = steps.find { |step| step['uses'] == 'actions/checkout@v4' }.fetch('with')
  raise 'Build a release tag' unless checkout['ref'] == 'refs/tags/@pascal-app/editor@${{ inputs.version }}'
  compose = YAML.load_file('docker-compose.yml').fetch('services').fetch('editor')
  raise 'Keep source builds working' unless compose['build'] == '.' && !compose.key?('image')
  raise 'Keep npm releases independent' if File.read('.github/workflows/release.yml').include?('docker/')
  puts 'PASS: Docker bootstrap workflow checks'
end
