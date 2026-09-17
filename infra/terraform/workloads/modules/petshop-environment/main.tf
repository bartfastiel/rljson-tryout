locals {
  nodes_by_name = { for node in var.nodes : node.name => node }
  hostnames     = { for node in var.nodes : node.name => "${node.name}${var.hostname_infix}.${var.base_domain}" }
  apex_hostname = var.hostname_infix == "" ? var.base_domain : "${trimprefix(var.hostname_infix, "-")}.${var.base_domain}"
  apex_node     = var.nodes[0].name

  # Every node learns the public URL of every node of this environment,
  # itself included, so that it can correlate the node ids discovery sees
  # with links a browser can open (`NODE_URLS` in roadmap section 2.4).
  public_urls = { for node in var.nodes : node.name => "https://${local.hostnames[node.name]}" }
  node_urls   = join(",", [for node in var.nodes : local.public_urls[node.name]])

  # cert-manager's ingress shim turns the annotation and the tls block into
  # one Certificate per ingress.
  ingress_annotations = {
    "cert-manager.io/cluster-issuer" = var.cluster_issuer
  }

  # A Deployment's selector is immutable, so these two labels never change;
  # everything else goes into the metadata labels below.
  selector_labels = {
    for node in var.nodes : node.name => {
      "app.kubernetes.io/name"     = "node-service"
      "app.kubernetes.io/instance" = node.name
    }
  }
  labels = {
    for node in var.nodes : node.name => merge(local.selector_labels[node.name], {
      "app.kubernetes.io/part-of" = "rljson-tryout"
    })
  }
}

resource "kubernetes_namespace_v1" "environment" {
  metadata {
    name = var.environment_name
    labels = {
      "app.kubernetes.io/part-of" = "rljson-tryout"
    }
  }

  wait_for_default_service_account = true
}

# The image runs as the user `node` by name; the kubelet can only enforce
# runAsNonRoot against a numeric user, so the pod names the uid and gid of
# that user (1000 in the official Node.js images).
resource "kubernetes_deployment_v1" "node" {
  for_each = local.nodes_by_name

  metadata {
    name      = each.key
    namespace = kubernetes_namespace_v1.environment.metadata[0].name
    labels    = local.labels[each.key]
  }

  spec {
    replicas               = 1
    revision_history_limit = 3

    selector {
      match_labels = local.selector_labels[each.key]
    }

    strategy {
      type = "RollingUpdate"

      rolling_update {
        max_surge       = 1
        max_unavailable = 0
      }
    }

    template {
      metadata {
        labels = local.selector_labels[each.key]
      }

      spec {
        automount_service_account_token = false

        # The root filesystem is read-only, so DATA_DIR, where discovery
        # persists the node identity, has to be a volume; for the in-memory
        # store an emptyDir is enough, it lasts as long as the pod does.
        volume {
          name = "data"

          empty_dir {}
        }

        security_context {
          run_as_non_root = true
          run_as_user     = 1000
          run_as_group    = 1000
          fs_group        = 1000

          seccomp_profile {
            type = "RuntimeDefault"
          }
        }

        container {
          name              = "node-service"
          image             = var.image
          image_pull_policy = "IfNotPresent"

          env {
            name  = "NODE_NAME"
            value = each.key
          }

          env {
            name  = "LOG_LEVEL"
            value = "info"
          }

          env {
            name  = "RLJSON_DOMAIN"
            value = var.rljson_domain
          }

          env {
            name  = "HUB_PORT"
            value = "3000"
          }

          env {
            name  = "BROADCAST_PORT"
            value = "41234"
          }

          env {
            name  = "DATA_DIR"
            value = "/data"
          }

          env {
            name  = "PUBLIC_URL"
            value = local.public_urls[each.key]
          }

          env {
            name  = "NODE_URLS"
            value = local.node_urls
          }

          volume_mount {
            name       = "data"
            mount_path = "/data"
          }

          port {
            name           = "http"
            container_port = 8080
            protocol       = "TCP"
          }

          # Peers reach each other on the pod address: TCP probes and, from
          # slice D2 on, the hub transport on the hub port; UDP broadcast
          # announcements on the broadcast port.
          port {
            name           = "hub"
            container_port = 3000
            protocol       = "TCP"
          }

          port {
            name           = "broadcast"
            container_port = 41234
            protocol       = "UDP"
          }

          readiness_probe {
            http_get {
              path = "/health"
              port = "http"
            }

            initial_delay_seconds = 2
            period_seconds        = 5
            failure_threshold     = 3
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = "http"
            }

            initial_delay_seconds = 10
            period_seconds        = 10
            failure_threshold     = 3
          }

          resources {
            requests = {
              cpu    = "100m"
              memory = "128Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "512Mi"
            }
          }

          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true

            capabilities {
              drop = ["ALL"]
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "node" {
  for_each = local.nodes_by_name

  metadata {
    name      = each.key
    namespace = kubernetes_namespace_v1.environment.metadata[0].name
    labels    = local.labels[each.key]
  }

  spec {
    type     = "ClusterIP"
    selector = local.selector_labels[each.key]

    port {
      name        = "http"
      port        = 80
      target_port = "http"
      protocol    = "TCP"
    }
  }
}

resource "kubernetes_ingress_v1" "node" {
  for_each = local.nodes_by_name

  metadata {
    name        = each.key
    namespace   = kubernetes_namespace_v1.environment.metadata[0].name
    labels      = local.labels[each.key]
    annotations = local.ingress_annotations
  }

  spec {
    ingress_class_name = "traefik"

    tls {
      hosts       = [local.hostnames[each.key]]
      secret_name = "${each.key}-tls"
    }

    rule {
      host = local.hostnames[each.key]

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.node[each.key].metadata[0].name

              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_ingress_v1" "apex" {
  count = var.enable_apex_ingress ? 1 : 0

  metadata {
    name        = "apex"
    namespace   = kubernetes_namespace_v1.environment.metadata[0].name
    labels      = local.labels[local.apex_node]
    annotations = local.ingress_annotations
  }

  spec {
    ingress_class_name = "traefik"

    tls {
      hosts       = [local.apex_hostname]
      secret_name = "apex-tls"
    }

    rule {
      host = local.apex_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.node[local.apex_node].metadata[0].name

              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }
}
